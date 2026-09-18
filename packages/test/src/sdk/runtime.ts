import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentDefinition,
	type AgentTrace,
	createAgentSession,
	type HarnessSession,
	toolPathsOutsideWorkspace,
} from "@post-print/agent-harness";
import { z } from "zod/v4";
import { configuredAgent, mergeSettings, validateSkills } from "./definitions.js";
import { evaluate } from "./judge.js";
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
}
interface RunInput {
	session: HarnessSession;
	workspace: Workspace;
	prompt: string;
	context: StartingContext;
	history: AgentTrace;
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
		workspace: {
			root: workspace.path,
			initial,
			final,
			changedPaths: changedPaths(initial, final),
		},
	};
}

function finalAssistantMessage(trace: AgentTrace): string {
	return trace.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
}
function assertWorkspacePaths(trace: AgentTrace, workspace: string) {
	const escaped = toolPathsOutsideWorkspace(trace, workspace);
	if (escaped.length)
		throw new Error(`Agent used paths outside the isolated workspace: ${escaped.join(", ")}`);
}

export class TestRuntime {
	private readonly resources: { session?: HarnessSession; cleanup(): Promise<void> }[] = [];
	private readonly pending = new Set<Promise<unknown>>();
	private readonly controller = new AbortController();
	private closed = false;
	constructor(readonly options: RuntimeOptions) {}
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
		return promise;
	}
	agent(
		name: string,
		settings: AgentSettings,
		preparation: readonly WorkspaceSetup[] = [],
	): AgentFixture {
		return {
			setup: (prepare) => this.agent(name, settings, [...preparation, prepare]),
			run: ({ prompt, ...options }) =>
				this.track(() =>
					this.start({ name, preparation, prompt }, mergeSettings(settings, options)),
				),
		};
	}
	judge<S extends z.ZodType>(name: string, settings: JudgeSettings<S>): JudgeFixture<z.output<S>> {
		const { prompt, schema, ...agentSettings } = settings;
		return {
			run: ({ input }) =>
				this.track(async () => {
					const definition = configuredAgent(this.options.judge, agentSettings);
					const id = crypto.randomUUID();
					let startedEvaluation: { prompt: string; schema: unknown } | undefined;
					const result = await evaluate({
						id,
						name,
						definition,
						settings: { ...agentSettings, prompt, schema },
						input,
						...this.options,
						signal: this.signal,
						onStart: ({ input: selectedInput, evaluation }) => {
							startedEvaluation = evaluation;
							this.options.onEvent?.({
								runId: id,
								type: "evaluation-start",
								value: { name, input: selectedInput, evaluation },
							});
						},
					});
					this.options.onEvent?.({
						runId: result.id,
						type: "evaluation",
						value: {
							...result,
							input,
							evaluation: startedEvaluation ?? {
								prompt,
								schema: z.toJSONSchema(schema),
							},
						},
					});
					return result;
				}),
		};
	}
	private async start(
		task: { name: string; prompt: string; preparation: readonly WorkspaceSetup[] },
		settings: AgentSettings,
	): Promise<Run> {
		const { name, prompt, preparation } = task;
		this.signal.throwIfAborted();
		if (typeof prompt !== "string" || !prompt.trim())
			throw new Error("agent.run requires a nonempty prompt");
		const definition = configuredAgent(this.options.agent, settings);
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
		});
		const history: AgentTrace = { messages: [], toolCalls: [], shellCommands: [], artifacts: {} };
		return this.conversation(name, {
			session: resource.session,
			workspace,
			context,
			history,
			prompt,
		});
	}
	private conversation(name: string, input: RunInput): Promise<Run> {
		let busy = false;
		const next = async (prompt: string): Promise<Run> => {
			if (busy) throw new Error("Overlapping continuations of one task are not supported");
			busy = true;
			try {
				return await this.run(name, { ...input, prompt }, (value) => this.track(() => next(value)));
			} finally {
				busy = false;
			}
		};
		return next(input.prompt);
	}
	private async run(
		name: string,
		input: RunInput,
		continuation: (prompt: string) => Promise<Run>,
	): Promise<Run> {
		const { session, workspace, prompt, context } = input;
		const id = crypto.randomUUID(),
			directory = join(this.options.outputDir, id);
		await mkdir(directory, { recursive: true });
		const initial = await snapshot(workspace.path, join(directory, "initial"));
		const start = performance.now();
		this.options.onEvent?.({ runId: id, type: "start", value: { prompt, name } });
		try {
			const trace = await session.run(withContext(prompt, context), (event) =>
				this.options.onEvent?.({ runId: id, type: "agent", value: event }),
			);
			assertWorkspacePaths(trace, workspace.path);
			const final = await snapshot(workspace.path, join(directory, "final"));
			const result: Run = {
				...captureRun({
					...input,
					name,
					artifact: directory,
					id,
					trace,
					initial,
					final,
					durationMs: Math.round(performance.now() - start),
				}),
				continue: (options) => continuation(options.prompt),
			};
			await writeJson(join(directory, "run.json"), result);
			this.options.onEvent?.({ runId: id, type: "complete", value: result });
			return result;
		} catch (error) {
			await writeJson(join(directory, "error.json"), { message: String(error) });
			throw error;
		}
	}
	async close() {
		this.closed = true;
		this.controller.abort();
		await Promise.allSettled([...this.pending]);
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
		if (errors.length) throw new AggregateError(errors, "Agent fixture cleanup failed");
	}
}
