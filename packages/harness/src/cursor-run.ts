import { type HostAuthMode, resolveKeyOrLoginAuthMode } from "./auth-mode.js";
import {
	accumulateSdkEvent,
	createTraceAccumulator,
	finalizeTraceAccumulator,
	normalizeAgentUsage,
	type SdkMessage,
} from "./capture.js";
import { createLiveNotifyState, emitLiveAgentEvents } from "./live-agent-event.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import {
	AgentRunTimeoutError,
	isUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "./run-guards.js";
import type { AgentTrace, AgentUsage, LiveAgentEvent } from "./types.js";
import { cursorSettingSources, withCursorUserHome } from "./user-skills.js";

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

export type CursorAuthMode = HostAuthMode;

export const CURSOR_AUTH_MODE_ENV = "CURSOR_AUTH_MODE";

export const CURSOR_MISSING_KEY_MESSAGE = "CURSOR_API_KEY required for --auth-mode api-key";

export function resolveCursorAuthMode(
	raw: string | undefined = process.env[CURSOR_AUTH_MODE_ENV],
	apiKey?: string,
	explicit?: CursorAuthMode,
): CursorAuthMode {
	return resolveKeyOrLoginAuthMode({
		envName: CURSOR_AUTH_MODE_ENV,
		raw,
		hasApiKey: Boolean((apiKey ?? process.env.CURSOR_API_KEY)?.trim()),
		missingKeyMessage: CURSOR_MISSING_KEY_MESSAGE,
		explicit,
	});
}

/**
 * In-process SDK env. Subscription mode drops CURSOR_API_KEY for the whole
 * run: the SDK prefers that env var over ~/.cursor/sdk/auth.json.
 */
export async function withCursorAuthEnv<T>(
	authMode: CursorAuthMode,
	run: () => Promise<T> | T,
): Promise<T> {
	if (authMode === "api-key") {
		return await run();
	}
	const prior = process.env.CURSOR_API_KEY;
	delete process.env.CURSOR_API_KEY;
	try {
		return await run();
	} finally {
		if (prior === undefined) {
			delete process.env.CURSOR_API_KEY;
		} else {
			process.env.CURSOR_API_KEY = prior;
		}
	}
}

export interface CursorRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	authMode?: CursorAuthMode;
	model?: { id: string; params?: Array<{ id: string; value: string }> };
	mcpServers?: Record<string, McpServerConfig>;
	/** Hard cap on stream + wait; omit for no harness deadline. */
	timeoutMs?: number;
	/** Fail fast when the agent invokes AskQuestion-style tools (default true). */
	failOnUserInput?: boolean;
	/** Fires immediately before the harness deadline timer arms (after pre-stream setup). */
	onDeadlineStart?: () => void | Promise<void>;
	/** Fires as the SDK streams assistant text and tool calls. */
	onAgentEvent?: (event: LiveAgentEvent) => void;
	/** Load host-global Cursor user skills and settings. Default false. */
	allowUserSkills?: boolean;
}

export interface JudgeClassifierOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	authMode?: CursorAuthMode;
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
	/** Token usage when the judge SDK run reported it. */
	usage?: AgentUsage;
}

export interface CursorRunResult {
	status: string;
	trace: AgentTrace;
	/** Unnormalized SDK terminal status from wait()/prompt. */
	rawStatus?: string;
	sdkError?: JudgeSdkError;
	/** Cumulative agent token usage when the SDK reported it. */
	usage?: AgentUsage;
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
	const authMode = resolveCursorAuthMode(undefined, options.apiKey, options.authMode);
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (authMode === "api-key" && !apiKey?.trim()) {
		throw new Error(CURSOR_MISSING_KEY_MESSAGE);
	}

	const sdkModule = await import("@cursor/sdk");
	const modelId = options.model?.id ?? process.env.CURSOR_AGENT_MODEL ?? DEFAULT_CURSOR_MODEL;
	const mcpServers = resolveMcpServers(options.mcpServers, {
		cwd: options.cwd,
	});
	return withCursorAuthEnv(authMode, () =>
		withCursorUserHome(options.allowUserSkills === true, async () => {
			const createOptions = {
				model: { id: modelId },
				local: {
					cwd: options.cwd,
					settingSources: cursorSettingSources(options.allowUserSkills === true),
				},
				...(mcpServers ? { mcpServers } : {}),
				...(authMode === "api-key" && apiKey ? { apiKey } : {}),
			};
			await using agent = await sdkModule.Agent.create(createOptions);

			const failOnUserInput = options.failOnUserInput !== false;
			const acc = createTraceAccumulator();
			const liveState = createLiveNotifyState();
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
						emitLiveAgentEvents(acc, liveState, options.onAgentEvent);
						const lastTool = acc.toolCalls.at(-1);
						if (lastTool && isUserInputTool(lastTool.name)) {
							if (failOnUserInput) {
								const userInputError = new UserInputRequiredError(lastTool.name);
								userInputError.trace = stashTrace();
								throw userInputError;
							}
							cancelSdkRun(run);
							return {
								status: "completed",
								trace: stashTrace(),
								rawStatus: "user_input",
							};
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
						usage: waitUsage,
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
		}),
	);
}

/** Classifier-only judge path — one-shot Agent.prompt, JSON reply, temperature 0 when supported. */
export async function runJudgeClassifier(
	options: JudgeClassifierOptions,
): Promise<JudgeClassifierResult> {
	const authMode = resolveCursorAuthMode(undefined, options.apiKey, options.authMode);
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (authMode === "api-key" && !apiKey?.trim()) {
		throw new Error(CURSOR_MISSING_KEY_MESSAGE);
	}

	const sdkModule = await import("@cursor/sdk");
	const result = await withCursorAuthEnv(authMode, () =>
		withCursorUserHome(false, () =>
			sdkModule.Agent.prompt(options.prompt, {
				...(authMode === "api-key" && apiKey ? { apiKey } : {}),
				model: judgeModelSelection(options.model),
				name: "agent-spec-judge",
				local: { cwd: options.cwd, settingSources: ["project"] },
			}),
		),
	);

	const text = result.result?.trim() ?? "";
	const rawStatus = result.status;
	const status = rawStatus === "finished" ? "completed" : rawStatus;
	const sdkError = extractJudgeSdkError(result.error);
	const usage = normalizeAgentUsage((result as { usage?: unknown }).usage);
	return {
		status: normalizeSdkRunStatus(status),
		text,
		rawStatus,
		sdkError,
		usage,
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
