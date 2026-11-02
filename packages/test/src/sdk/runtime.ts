import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentDefinition,
	AgentInfrastructureError,
	type AgentTrace,
	assertInsideWorkspace,
	createAgentSession,
	type HarnessSession,
	listMcpCatalog,
	type McpCatalogEntry,
} from "@post-print/agent-harness";
import { z } from "zod";
import { trackOperationOutput } from "./criterion-provenance.js";
import { configuredAgent, mergeSettings, validateSkills } from "./definitions.js";
import {
	captureEnvironmentBaseline,
	type EnvironmentBaseline,
	type EnvironmentObservation,
	observeEnvironment,
	stopSurvivors,
} from "./environment-observation.js";
import { isInfrastructureFailure, recordedFailure } from "./failure.js";
import { evaluate } from "./judge.js";
import { OperationLedger, UnearnedResultError } from "./operation-ledger.js";
import {
	buildRunRecord,
	ConditionsUnknownError,
	runExposure,
	runRecordBase,
} from "./run-record.js";
import {
	preserveSourceChanges,
	releaseSnapshots,
	snapshotBudget,
	sourceEvidenceBudget,
} from "./snapshot-storage.js";
import type {
	AgentFixture,
	AgentSettings,
	JudgeFixture,
	JudgeSettings,
	Run,
	WorkspaceSetup,
} from "./types.js";
import { runUsage } from "./usage.js";
import {
	callerCheckout,
	changedPaths,
	prepareAgent,
	prepareWorkspace,
	type StartingContext,
	snapshot,
	type Workspace,
	withContext,
	writeJson,
} from "./workspace.js";
export interface RuntimeOptions {
	baseDir: string;
	outputDir: string;
	agent?: AgentDefinition;
	judge?: AgentDefinition;
	workspace: string;
	signal: AbortSignal;
	onEvent?: (event: { runId: string; type: string; value: unknown }) => void;
	/** Time left before the test runner kills this test; undefined when it has no limit. */
	remainingTestMs?: () => number | undefined;
	testFile?: string;
}
const HOST_DEADLINE_GRACE_MS = 5_000;
const MINIMUM_HOST_DEADLINE_MS = 1_000;
/** A stalled host must hit its own deadline first, so it is recorded as infrastructure with its trace. */
function withinTestDeadline(definition: AgentDefinition, remainingMs?: number): AgentDefinition {
	const { timeoutMs } = definition.options;
	if (timeoutMs === undefined || remainingMs === undefined) return definition;
	const budget = Math.max(remainingMs - HOST_DEADLINE_GRACE_MS, MINIMUM_HOST_DEADLINE_MS);
	if (timeoutMs <= budget) return definition;
	return { ...definition, options: { ...definition.options, timeoutMs: budget } };
}
interface RunInput {
	session: HarnessSession;
	workspace: Workspace;
	prompt: string;
	invocationIndex: number;
	context: StartingContext;
	history: AgentTrace;
	settings: AgentSettings;
	definition: AgentDefinition;
	mcpCatalog: McpCatalogEntry[];
	/** Taken once per task, so a process from an earlier turn still counts on a continuation. */
	environmentBaseline?: EnvironmentBaseline;
}
interface CaptureInput {
	name: string;
	artifact: string;
	id: string;
	prompt: string;
	trace: AgentTrace;
	history: AgentTrace;
	durationMs: number;
	context: StartingContext;
	session: HarnessSession;
	workspace: Workspace;
	initial: Awaited<ReturnType<typeof snapshot>>;
	final: Awaited<ReturnType<typeof snapshot>>;
	record: Run["record"];
	mcpCatalog: McpCatalogEntry[];
	environment?: EnvironmentObservation;
}
function captureRun(input: CaptureInput): Omit<Run, "continue"> {
	const { id, prompt, trace, history, durationMs, context, session, workspace, initial, final } =
		input;
	history.messages.push(...trace.messages);
	history.toolCalls.push(...trace.toolCalls);
	history.shellCommands.push(...trace.shellCommands);
	return {
		id,
		name: input.name,
		artifact: input.artifact,
		prompt,
		trace,
		conversation: structuredClone(history),
		output: finalAssistantMessage(trace),
		toolCalls: trace.toolCalls,
		durationMs,
		usage: runUsage(trace.usage),
		capabilities: session.capabilities,
		startingContext: context,
		record: input.record,
		exposure: runExposure(trace.hostReport, input.mcpCatalog),
		...(input.environment ? { environment: input.environment } : {}),
		workspace: {
			root: workspace.path,
			initial,
			final,
			changedPaths: changedPaths(initial, final),
		},
	};
}

interface FinishedTurn {
	id: string;
	name: string;
	directory: string;
	input: RunInput;
	trace: AgentTrace;
	initial: Awaited<ReturnType<typeof snapshot>>;
	start: number;
	continuation: (prompt: string) => Promise<Run>;
}
interface AgentTask {
	name: string;
	prompt: string;
	preparation: readonly WorkspaceSetup[];
	invocationIndex: number;
}
/** No host has been asked anything for this run yet, so its failure says nothing about the agent. */
async function preparing<T>(prepare: () => Promise<T>): Promise<T> {
	try {
		return await prepare();
	} catch (error) {
		if (isInfrastructureFailure(error) || (error as Error).name === "AbortError") throw error;
		throw new UnearnedResultError((error as Error).message);
	}
}
/** The agent's turn is over. If keeping its evidence fails, that failure is the runner's. */
async function recordingRun(record: () => Promise<Run>): Promise<Run> {
	try {
		return await record();
	} catch (error) {
		if (error instanceof ConditionsUnknownError) throw error;
		throw new AgentInfrastructureError(
			`The run finished but could not be recorded: ${(error as Error).message}`,
			"capture_incomplete",
		);
	}
}
/** The agent's work is finished and judged. A failure to clean up after it says nothing about it. */
class RunnerCleanupError extends AggregateError {
	constructor(errors: unknown[]) {
		super(errors, `Agent fixture cleanup failed: ${errors.map(String).join("; ")}`);
		this.name = "RunnerCleanupError";
	}
}

function finalAssistantMessage(trace: AgentTrace): string {
	return trace.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
}

export class TestRuntime {
	private readonly resources: { session?: HarnessSession; cleanup(): Promise<void> }[] = [];
	private readonly pending = new Set<Promise<unknown>>();
	private readonly ledger = new OperationLedger();
	private readonly controller = new AbortController();
	private readonly snapshotStorage = snapshotBudget();
	private readonly sourceEvidenceStorage = sourceEvidenceBudget();
	private readonly survivors: number[] = [];
	private recordBase?: ReturnType<typeof runRecordBase>;
	private protectedPaths?: Promise<string[]>;
	private nextInvocationIndex = 0;
	private closed = false;
	constructor(readonly options: RuntimeOptions) {}
	/** Paths every session in this test is denied: the checkout holding the suite. */
	private checkoutPaths(): Promise<string[]> {
		this.protectedPaths ??= callerCheckout(this.options.baseDir).then((path) => [path]);
		return this.protectedPaths;
	}
	private get signal() {
		return AbortSignal.any([this.options.signal, this.controller.signal]);
	}
	private track<T>(operation: () => Promise<T>): Promise<T> {
		if (this.closed) return Promise.reject(new Error("Test runtime is closed"));
		const promise = Promise.resolve().then(operation);
		this.pending.add(promise);
		void promise.then(
			() => this.pending.delete(promise),
			() => this.pending.delete(promise),
		);
		return this.ledger.record(promise);
	}
	assertResultEarned(options: { noAgent: boolean }): void {
		this.ledger.assertResultEarned(options);
	}
	failedBeforeAnyHostStarted(): boolean {
		return this.ledger.failedBeforeAnyHostStarted();
	}
	reportedInfrastructureFailure(): boolean {
		return this.ledger.reportedInfrastructureFailure();
	}
	private forTest(definition: AgentDefinition): AgentDefinition {
		return withinTestDeadline(definition, this.options.remainingTestMs?.());
	}
	agent(
		name: string,
		settings: AgentSettings,
		preparation: readonly WorkspaceSetup[] = [],
	): AgentFixture {
		return {
			setup: (prepare) => this.agent(name, settings, [...preparation, prepare]),
			run: ({ prompt, ...options }) => {
				const invocationIndex = this.nextInvocationIndex++;
				return this.track(() =>
					this.start(
						{ name, preparation, prompt, invocationIndex },
						mergeSettings(settings, options),
					),
				);
			},
		};
	}
	judge<S extends z.ZodType>(name: string, settings: JudgeSettings<S>): JudgeFixture<z.output<S>> {
		const { prompt, schema, ...agentSettings } = settings;
		return {
			run: ({ input }) => {
				const invocationIndex = this.nextInvocationIndex++;
				return this.track(async () => {
					const definition = await this.judgeDefinition(agentSettings);
					this.ledger.noteHostStarted();
					const id = crypto.randomUUID();
					let startedEvaluation: { prompt: string; schema: unknown } | undefined;
					let result;
					try {
						result = await evaluate({
							id,
							name,
							definition,
							settings: { ...agentSettings, prompt, schema },
							input,
							...this.options,
							protectedPaths: await this.checkoutPaths(),
							signal: this.signal,
							onStart: ({ input: selectedInput, evaluation }) => {
								startedEvaluation = evaluation;
								this.options.onEvent?.({
									runId: id,
									type: "evaluation-start",
									value: { name, input: selectedInput, evaluation, invocationIndex },
								});
							},
						});
					} catch (error) {
						this.options.onEvent?.({ runId: id, type: "error", value: recordedFailure(error) });
						throw error;
					}
					this.options.onEvent?.({
						runId: result.id,
						type: "evaluation",
						value: {
							...result,
							invocationIndex,
							input,
							evaluation: startedEvaluation ?? {
								prompt,
								schema: z.toJSONSchema(schema),
							},
						},
					});
					return trackOperationOutput(result);
				});
			},
		};
	}
	private judgeDefinition(settings: AgentSettings): Promise<AgentDefinition> {
		return preparing(async () => this.forTest(configuredAgent(this.options.judge, settings)));
	}
	private async start(task: AgentTask, settings: AgentSettings): Promise<Run> {
		const input = await preparing(() => this.prepareTask(task, settings));
		return this.conversation(task.name, input);
	}
	private async prepareTask(task: AgentTask, settings: AgentSettings): Promise<RunInput> {
		const { prompt, preparation, invocationIndex } = task;
		this.signal.throwIfAborted();
		if (typeof prompt !== "string" || !prompt.trim())
			throw new Error("agent.run requires a nonempty prompt");
		const definition = this.forTest(configuredAgent(this.options.agent, settings));
		validateSkills(definition.options.skills ?? [], this.options.baseDir);
		const workspace = await prepareWorkspace(
			this.options.baseDir,
			settings.workspace ?? this.options.workspace,
		);
		const resource = {
			session: undefined as HarnessSession | undefined,
			cleanup: workspace.cleanup,
		};
		this.resources.push(resource);
		for (const prepare of preparation) await prepare(workspace);
		const context = await prepareAgent(definition, this.options.baseDir, workspace.path);
		this.signal.throwIfAborted();
		resource.session = await createAgentSession({
			agent: definition,
			workspace: workspace.path,
			signal: this.signal,
			protectedPaths: await this.checkoutPaths(),
		});
		const history: AgentTrace = { messages: [], toolCalls: [], shellCommands: [], artifacts: {} };
		return {
			environmentBaseline: settings.observeEnvironment
				? await captureEnvironmentBaseline()
				: undefined,
			settings,
			definition,
			mcpCatalog: await listMcpCatalog(definition.options.mcpServers, { cwd: workspace.path }),
			session: resource.session,
			workspace,
			context,
			history,
			prompt,
			invocationIndex,
		};
	}
	private conversation(name: string, input: RunInput): Promise<Run> {
		let busy = false;
		const next = async (prompt: string, invocationIndex: number): Promise<Run> => {
			if (busy) throw new Error("Overlapping continuations of one task are not supported");
			busy = true;
			try {
				return await this.run(name, { ...input, prompt, invocationIndex }, (value) => {
					const nextIndex = this.nextInvocationIndex++;
					return this.track(() => next(value, nextIndex));
				});
			} finally {
				busy = false;
			}
		};
		return next(input.prompt, input.invocationIndex);
	}
	private async run(
		name: string,
		input: RunInput,
		continuation: (prompt: string) => Promise<Run>,
	): Promise<Run> {
		const { session, workspace, prompt, context } = input;
		const id = crypto.randomUUID(),
			directory = join(this.options.outputDir, id);
		const initial = await preparing(async () => {
			await mkdir(directory, { recursive: true });
			return snapshot(workspace.path, join(directory, "initial"), this.snapshotStorage);
		});
		const start = performance.now();
		this.announceRun(id, name, input);
		this.ledger.noteHostStarted();
		try {
			const trace = await session.run(withContext(prompt, context), (event) =>
				this.options.onEvent?.({ runId: id, type: "agent", value: event }),
			);
			assertInsideWorkspace(trace, workspace.path);
			const result = await recordingRun(() =>
				this.recordFinishedTurn({
					id,
					name,
					directory,
					input,
					trace,
					initial,
					start,
					continuation,
				}),
			);
			this.options.onEvent?.({ runId: id, type: "complete", value: result });
			return trackOperationOutput(result);
		} catch (error) {
			const failure = recordedFailure(error);
			this.options.onEvent?.({ runId: id, type: "error", value: failure });
			await writeJson(join(directory, "error.json"), failure);
			await this.captureFailure({ workspace, directory, initial });
			throw error;
		}
	}
	private async recordFinishedTurn(turn: FinishedTurn): Promise<Run> {
		const { id, name, directory, input, trace, initial, start, continuation } = turn;
		const { workspace, session, settings, environmentBaseline: baseline } = input;
		const observed = settings.observeEnvironment;
		const environment =
			observed && baseline
				? await observeEnvironment({ baseline, workspace: workspace.path, observe: observed })
				: undefined;
		this.survivors.push(...(environment?.stoppablePids ?? []));
		const final = await snapshot(workspace.path, join(directory, "final"), this.snapshotStorage);
		await this.preserveChanges({ initial, final, directory });
		const record = await this.runRecord(input, trace, initial);
		const durationMs = Math.round(performance.now() - start);
		const captured = { ...input, session, environment, record, name, artifact: directory, id };
		const result: Run = {
			...captureRun({ ...captured, trace, initial, final, durationMs }),
			continue: (options) => continuation(options.prompt),
		};
		await writeJson(join(directory, "run.json"), result);
		return result;
	}
	private async runRecord(
		input: RunInput,
		trace: AgentTrace,
		initial: Awaited<ReturnType<typeof snapshot>>,
	): Promise<Run["record"]> {
		this.recordBase ??= runRecordBase(this.options.baseDir, this.options.testFile);
		return buildRunRecord(await this.recordBase, {
			conditions: await input.session.conditions,
			definition: input.definition,
			hostReport: trace.hostReport,
			prompt: input.prompt,
			context: input.context,
			initial,
		});
	}
	private announceRun(id: string, name: string, input: RunInput): void {
		this.options.onEvent?.({
			runId: id,
			type: "start",
			value: { prompt: input.prompt, name, invocationIndex: input.invocationIndex },
		});
	}
	private preserveChanges(input: Omit<Parameters<typeof preserveSourceChanges>[0], "budget">) {
		return preserveSourceChanges({ ...input, budget: this.sourceEvidenceStorage });
	}

	private async captureFailure(input: {
		workspace: Workspace;
		directory: string;
		initial: Awaited<ReturnType<typeof snapshot>>;
	}): Promise<void> {
		try {
			const final = await snapshot(
				input.workspace.path,
				join(input.directory, "failure", "final"),
				this.snapshotStorage,
			);
			await preserveSourceChanges({ ...input, final, budget: this.sourceEvidenceStorage });
		} catch (error) {
			await writeJson(join(input.directory, "source-evidence-error.json"), recordedFailure(error));
		}
	}

	async close() {
		this.closed = true;
		this.controller.abort();
		await Promise.allSettled([...this.pending]);
		stopSurvivors(this.survivors);
		const errors: unknown[] = [];
		for (const resource of this.resources.splice(0).reverse()) {
			try {
				await resource.session?.close();
			} catch (error) {
				errors.push(error);
			}
			try {
				await resource.cleanup();
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			await releaseSnapshots(this.options.outputDir);
		} catch (error) {
			errors.push(error);
		}
		if (errors.length) throw new RunnerCleanupError(errors);
	}
}
