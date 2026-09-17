import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentDefinition,
	type AgentTrace,
	createAgentSession,
	type HarnessSession,
	toolPathsOutsideWorkspace,
} from "@post-print/agent-harness";
import { compareVariants } from "./comparison.js";
import { judgeRun, runUsage } from "./judge.js";
import type { CompareOptions, Comparison, Criteria, JudgeDefinition, Run } from "./types.js";
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

export interface AgentFixture {
	run(prompt: string): Promise<Run>;
}
export interface RuntimeOptions {
	baseDir: string;
	outputDir: string;
	agent?: AgentDefinition;
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
function captureRun(input: CaptureInput): Omit<Run, "judge"> {
	const { id, prompt, trace, history, durationMs, context, session, workspace, initial, final } =
		input;
	history.messages.push(...trace.messages);
	history.toolCalls.push(...trace.toolCalls);
	history.shellCommands.push(...trace.shellCommands);
	return {
		id,
		prompt,
		trace,
		conversation: structuredClone(history),
		output: trace.messages
			.filter((message) => message.role === "assistant")
			.map((message) => message.content)
			.join("\n"),
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
function assertWorkspacePaths(trace: AgentTrace, workspace: string) {
	const escaped = toolPathsOutsideWorkspace(trace, workspace);
	if (escaped.length)
		throw new Error(`Agent used paths outside the isolated workspace: ${escaped.join(", ")}`);
}
export class TestRuntime {
	private resources: { session?: HarnessSession; cleanup(): Promise<void> }[] = [];
	private closed = false;
	constructor(readonly options: RuntimeOptions) {}
	async createAgent(
		definition = this.options.agent,
		source = this.options.workspace,
	): Promise<{ agent: AgentFixture; workspace: Workspace; close(): Promise<void> }> {
		if (this.closed) throw new Error("Test runtime is closed");
		if (!definition) throw new Error("Configure an agent with test.use({ agent: openai() })");
		this.options.signal.throwIfAborted();
		const workspace = await prepareWorkspace(this.options.baseDir, source);
		const resource = {
			session: undefined as HarnessSession | undefined,
			cleanup: workspace.cleanup,
		};
		this.resources.push(resource);
		const context = await prepareAgent(definition, this.options.baseDir, workspace.path);
		const history: AgentTrace = { messages: [], toolCalls: [], shellCommands: [], artifacts: {} };
		let busy = false;
		let ended = false;
		const agent: AgentFixture = {
			run: async (prompt) => {
				if (ended || this.closed) throw new Error("Agent fixture is closed");
				if (busy) throw new Error("Overlapping runs on one agent are not supported; use variants");
				busy = true;
				try {
					resource.session ??= await createAgentSession({
						agent: definition,
						workspace: workspace.path,
						signal: this.options.signal,
					});
					return await this.run({ session: resource.session, workspace, prompt, context, history });
				} finally {
					busy = false;
				}
			},
		};
		return {
			agent,
			workspace,
			close: async () => {
				if (ended) return;
				ended = true;
				try {
					await resource.session?.close();
				} finally {
					await resource.cleanup();
					this.resources = this.resources.filter((item) => item !== resource);
				}
			},
		};
	}
	private async run(input: RunInput): Promise<Run> {
		const { session, workspace, prompt, context, history } = input;
		const id = crypto.randomUUID();
		const directory = join(this.options.outputDir, id);
		await mkdir(directory, { recursive: true });
		const initial = await snapshot(workspace.path, join(directory, "initial"));
		const start = performance.now();
		this.options.onEvent?.({ runId: id, type: "start", value: { prompt } });
		try {
			const trace = await session.run(withContext(prompt, context), (event) =>
				this.options.onEvent?.({ runId: id, type: "agent", value: event }),
			);
			assertWorkspacePaths(trace, workspace.path);
			const durationMs = Math.round(performance.now() - start);
			const final = await snapshot(workspace.path, join(directory, "final"));

			const result: Run = {
				...captureRun({
					id,
					prompt,
					trace,
					history,
					durationMs,
					context,
					session,
					workspace,
					initial,
					final,
				}),
				judge: <C extends Criteria>(definition: JudgeDefinition<C>) =>
					judgeRun(result, definition, this.options).then((grade) => {
						this.options.onEvent?.({
							runId: id,
							type: "grade",
							value: { grade, criteria: definition.criteria },
						});
						return grade;
					}),
			};
			await writeJson(join(directory, "run.json"), result);
			this.options.onEvent?.({ runId: id, type: "complete", value: result });
			return result;
		} catch (error) {
			await writeJson(join(directory, "error.json"), { message: String(error) });
			this.options.onEvent?.({ runId: id, type: "error", value: String(error) });
			throw error;
		}
	}
	compare<V extends string>(options: CompareOptions<V>): Promise<Comparison<V>> {
		return compareVariants(this, options);
	}

	async close() {
		this.closed = true;
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
