import {
	accumulateSdkEvent,
	createTraceAccumulator,
	finalizeTraceAccumulator,
	normalizeAgentUsage,
	type SdkMessage,
} from "./capture.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import {
	AgentRunTimeoutError,
	isUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "./run-guards.js";
import type { AgentTrace, AgentUsage } from "./types.js";

/** Minimal Cursor SDK run surface for cancel + wait cleanup. */
interface CancellableSdkRun {
	stream: () => AsyncIterable<unknown>;
	wait: () => Promise<{
		status: string;
		error?: { message?: string; code?: string };
		usage?: AgentUsage;
	}>;
	supports?: (op: string) => boolean;
	cancel?: () => void | Promise<void>;
	usage?: AgentUsage;
}

/** Default local agent model; override with CURSOR_AGENT_MODEL or options.model. */
const DEFAULT_CURSOR_MODEL = "auto";

function judgeModelSelection(override?: JudgeClassifierOptions["model"]): {
	id: string;
	params?: Array<{ id: string; value: string }>;
} {
	const id =
		override?.id ??
		process.env.CURSOR_JUDGE_MODEL ??
		process.env.CURSOR_AGENT_MODEL ??
		DEFAULT_CURSOR_MODEL;
	const params = override?.params ?? judgeModelParamsFromEnv();
	return params ? { id, params } : { id };
}

function judgeModelParamsFromEnv(): Array<{ id: string; value: string }> | undefined {
	const raw = process.env.CURSOR_JUDGE_TEMPERATURE ?? "0";
	if (!raw.trim()) {
		return undefined;
	}
	return [{ id: "temperature", value: raw.trim() }];
}

export interface CursorRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: { id: string; params?: Array<{ id: string; value: string }> };
	mcpServers?: Record<string, McpServerConfig>;
	/** Hard cap on stream + wait; omit for no harness deadline. */
	timeoutMs?: number;
	/** Fail fast when the agent invokes AskQuestion-style tools (default true). */
	failOnUserInput?: boolean;
	/** Fires immediately before the harness deadline timer arms (after pre-stream setup). */
	onDeadlineStart?: () => void | Promise<void>;
}

export interface JudgeClassifierOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: { id: string; params?: Array<{ id: string; value: string }> };
}

export interface JudgeSdkError {
	message?: string;
	code?: string;
}

export interface JudgeClassifierResult {
	status: string;
	text: string;
	/** Unnormalized SDK terminal status (e.g. `error`, `cancelled`). */
	rawStatus?: string;
	/** SDK error payload when the judge run did not finish cleanly. */
	sdkError?: JudgeSdkError;
}

export interface CursorRunResult {
	status: string;
	trace: AgentTrace;
	/** Unnormalized SDK terminal status from wait()/prompt. */
	rawStatus?: string;
	sdkError?: JudgeSdkError;
}

/** Map Cursor SDK terminal status to harness run status. */
export function normalizeSdkRunStatus(status: string): "completed" | "failed" {
	return status === "finished" || status === "completed" ? "completed" : "failed";
}

/** Human-readable cursor run failure line for AgentSession.error / assertion evidence. */
export function formatCursorRunFailure(options: {
	status: string;
	rawStatus?: string;
	sdkError?: JudgeSdkError;
}): string {
	const details: string[] = [];
	if (options.rawStatus && options.rawStatus !== options.status) {
		details.push(`sdk: ${options.rawStatus}`);
	} else if (options.rawStatus) {
		details.push(`sdk: ${options.rawStatus}`);
	}
	if (options.sdkError?.code) {
		details.push(`code: ${options.sdkError.code}`);
	}
	if (options.sdkError?.message) {
		details.push(`error: ${options.sdkError.message}`);
	}
	const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
	return `cursor run status: ${options.status}${suffix}`;
}

function cancelSdkRun(run: CancellableSdkRun | undefined): void {
	if (!run) {
		return;
	}

	void (async () => {
		try {
			if (typeof run.supports === "function" && run.supports("cancel")) {
				await run.cancel?.();
			}
		} catch {
			// best-effort
		}

		try {
			await run.wait();
		} catch {
			// expected after cancel or timeout
		}
	})();
}

/** In-process Cursor SDK run currently owned by `runCursorAgent` (for Ctrl+C / SIGTERM). */
let activeCursorRun: CancellableSdkRun | undefined;

/** Latest finalized (or partial) trace from the in-process cursor run — for timeout/catch recovery. */
let lastCursorRunTrace: AgentTrace | undefined;

/** Best-effort cancel of the in-flight Cursor SDK run (no-op when idle). */
export function cancelActiveCursorRun(): void {
	cancelSdkRun(activeCursorRun);
	activeCursorRun = undefined;
}

/** Consume the most recent partial/full cursor trace (clears the stash). */
export function takeLastCursorRunTrace(): AgentTrace | undefined {
	const trace = lastCursorRunTrace;
	lastCursorRunTrace = undefined;
	return trace;
}

/** Shared Cursor SDK path — Agent.create + send + wait (runs and judge use the same surface). */
export async function runCursorAgent(options: CursorRunOptions): Promise<CursorRunResult> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		throw new Error("CURSOR_API_KEY not set");
	}

	const sdkModule = await import("@cursor/sdk");
	const modelId = options.model?.id ?? process.env.CURSOR_AGENT_MODEL ?? DEFAULT_CURSOR_MODEL;
	const mcpServers = resolveMcpServers(options.mcpServers, {
		cwd: options.cwd,
	});
	await using agent = await sdkModule.Agent.create({
		apiKey,
		model: { id: modelId },
		local: { cwd: options.cwd },
		...(mcpServers ? { mcpServers } : {}),
	});

	const failOnUserInput = options.failOnUserInput !== false;
	const acc = createTraceAccumulator();
	let timedOut = false;

	const stashTrace = (usageOverride?: AgentUsage): AgentTrace => {
		const trace = finalizeTraceAccumulator(acc);
		const usage = usageOverride ?? normalizeAgentUsage(acc.usage) ?? trace.usage;
		const withUsage = usage ? { ...trace, usage } : trace;
		lastCursorRunTrace = withUsage;
		return withUsage;
	};

	const execute = async (): Promise<CursorRunResult> => {
		const run = (await agent.send(options.prompt)) as CancellableSdkRun;
		activeCursorRun = run;
		if (timedOut) {
			cancelSdkRun(run);
			activeCursorRun = undefined;
			const timeoutError = new AgentRunTimeoutError(options.timeoutMs ?? 0);
			timeoutError.trace = stashTrace();
			throw timeoutError;
		}

		try {
			for await (const event of run.stream()) {
				accumulateSdkEvent(acc, event as SdkMessage);
				if (failOnUserInput) {
					const lastTool = acc.toolCalls.at(-1);
					if (lastTool && isUserInputTool(lastTool.name)) {
						const userInputError = new UserInputRequiredError(lastTool.name);
						userInputError.trace = stashTrace();
						throw userInputError;
					}
				}
			}
			const result = await run.wait();
			const rawStatus = result.status;
			const status = normalizeSdkRunStatus(rawStatus);
			const sdkError = extractJudgeSdkError(result.error);
			// Prefer wait()/handle cumulative usage over summed stream turns when present.
			const waitUsage = normalizeAgentUsage(result.usage) ?? normalizeAgentUsage(run.usage);
			return {
				status,
				trace: stashTrace(waitUsage),
				rawStatus,
				sdkError,
			};
		} catch (error) {
			cancelSdkRun(run);
			const partial = stashTrace();
			if (error instanceof AgentRunTimeoutError || error instanceof UserInputRequiredError) {
				error.trace = error.trace ?? partial;
				throw error;
			}
			throw error;
		} finally {
			if (activeCursorRun === run) {
				activeCursorRun = undefined;
			}
		}
	};

	if (options.timeoutMs && options.timeoutMs > 0) {
		await options.onDeadlineStart?.();
		try {
			return await withRunTimeout(execute, options.timeoutMs, {
				onTimeout: () => {
					timedOut = true;
					cancelSdkRun(activeCursorRun);
				},
			});
		} catch (error) {
			if (error instanceof AgentRunTimeoutError) {
				error.trace = error.trace ?? takeLastCursorRunTrace();
			}
			throw error;
		}
	}
	return execute();
}

/** Classifier-only judge path — one-shot Agent.prompt, JSON reply, temperature 0 when supported. */
export async function runJudgeClassifier(
	options: JudgeClassifierOptions,
): Promise<JudgeClassifierResult> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		throw new Error("CURSOR_API_KEY not set");
	}

	const sdkModule = await import("@cursor/sdk");
	const result = await sdkModule.Agent.prompt(options.prompt, {
		apiKey,
		model: judgeModelSelection(options.model),
		name: "agent-spec-judge",
		local: { cwd: options.cwd },
	});

	const text = result.result?.trim() ?? "";
	const rawStatus = result.status;
	const status = rawStatus === "finished" ? "completed" : rawStatus;
	const sdkError = extractJudgeSdkError(result.error);
	return {
		status: normalizeSdkRunStatus(status),
		text,
		rawStatus,
		sdkError,
	};
}

function extractJudgeSdkError(error: unknown): JudgeSdkError | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const record = error as { message?: unknown; code?: unknown };
	const message = typeof record.message === "string" ? record.message : undefined;
	const code = typeof record.code === "string" ? record.code : undefined;
	if (!message && !code) {
		return undefined;
	}
	return { message, code };
}

/** Assistant prose from a Cursor SDK message stream (last assistant block wins for short replies). */
export function assistantTextFromSdkMessages(messages: SdkMessage[]): string {
	const chunks: string[] = [];
	for (const event of messages) {
		const text = textBlocksFromSdkMessage(event);
		if (text.length > 0 && (event.type === "assistant" || event.message?.role === "assistant")) {
			chunks.push(text);
		}
	}
	return chunks.join("\n").trim();
}

export function textBlocksFromSdkMessage(event: SdkMessage): string {
	const parts: string[] = [];

	if (event.message?.content) {
		for (const block of event.message.content) {
			if (block.text) {
				parts.push(block.text);
			}
		}
	}

	if (event.tool?.input !== undefined) {
		parts.push(
			typeof event.tool.input === "string" ? event.tool.input : JSON.stringify(event.tool.input),
		);
	}
	if (event.tool?.output) {
		parts.push(event.tool.output);
	}

	return parts.join("\n");
}
