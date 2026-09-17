import { type HostAuthMode, resolveKeyOrLoginAuthMode } from "./auth-mode.js";
import {
	accumulateSdkEvent,
	createTraceAccumulator,
	finalizeTraceAccumulator,
	normalizeAgentUsage,
	type SdkMessage,
} from "./capture.js";
import {
	CURSOR_SDK_LOGIN_HINT,
	isInvalidCursorUserApiKey,
	wrapCursorSdkAuthError,
} from "./cursor-auth.js";
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

/** Keep Cursor shell tools in the same local workspace used by file tools. */
async function withProcessWorkingDirectory<T>(cwd: string, run: () => Promise<T>): Promise<T> {
	const prior = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(prior);
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
	includeGlobalSkills?: boolean;
}

export interface CursorSdkError {
	message?: string;
	code?: string;
}

export interface CursorRunResult {
	status: string;
	trace: AgentTrace;
	/** Unnormalized SDK terminal status from wait()/prompt. */
	rawStatus?: string;
	sdkError?: CursorSdkError;
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
	sdkError?: CursorSdkError;
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
	const line = `cursor run status: ${options.status}${suffix}`;
	if (isInvalidCursorUserApiKey(options.sdkError) || isInvalidCursorUserApiKey(line)) {
		return `${line}. ${CURSOR_SDK_LOGIN_HINT}`;
	}
	return line;
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

interface CursorAgentHandle {
	send(prompt: string): Promise<unknown>;
}
class CursorExecution {
	private readonly acc = createTraceAccumulator();
	private readonly liveState = createLiveNotifyState();
	private timedOut = false;
	constructor(
		private readonly options: CursorRunOptions,
		private readonly agent: CursorAgentHandle,
	) {}
	private stashTrace(usageOverride?: AgentUsage): AgentTrace {
		const trace = finalizeTraceAccumulator(this.acc);
		const usage = usageOverride ?? normalizeAgentUsage(this.acc.usage) ?? trace.usage;
		const withUsage = usage ? { ...trace, usage } : trace;
		lastCursorRunTrace = withUsage;
		return withUsage;
	}
	private checkDeadline(run: CancellableSdkRun): void {
		if (!this.timedOut) return;
		cancelSdkRun(run);
		activeCursorRun = undefined;
		const error = new AgentRunTimeoutError(this.options.timeoutMs ?? 0);
		error.trace = this.stashTrace();
		throw error;
	}
	private async readStream(run: CancellableSdkRun): Promise<CursorRunResult | undefined> {
		for await (const event of run.stream()) {
			accumulateSdkEvent(this.acc, event as SdkMessage);
			emitLiveAgentEvents(this.acc, this.liveState, this.options.onAgentEvent);
			const lastTool = this.acc.toolCalls.at(-1);
			if (!lastTool || !isUserInputTool(lastTool.name)) continue;
			if (this.options.failOnUserInput !== false) {
				const error = new UserInputRequiredError(lastTool.name);
				error.trace = this.stashTrace();
				throw error;
			}
			cancelSdkRun(run);
			return { status: "completed", trace: this.stashTrace(), rawStatus: "user_input" };
		}
		return undefined;
	}
	private async finish(run: CancellableSdkRun): Promise<CursorRunResult> {
		const early = await this.readStream(run);
		if (early) return early;
		const result = await run.wait();
		const usage = normalizeAgentUsage(result.usage) ?? normalizeAgentUsage(run.usage);
		return {
			status: normalizeSdkRunStatus(result.status),
			trace: this.stashTrace(usage),
			rawStatus: result.status,
			sdkError: extractCursorSdkError(result.error),
			usage,
		};
	}
	private async execute(): Promise<CursorRunResult> {
		const run = (await this.agent.send(this.options.prompt)) as CancellableSdkRun;
		activeCursorRun = run;
		this.checkDeadline(run);
		try {
			return await this.finish(run);
		} catch (error) {
			cancelSdkRun(run);
			const partial = this.stashTrace();
			if (error instanceof AgentRunTimeoutError || error instanceof UserInputRequiredError) {
				error.trace = error.trace ?? partial;
				throw error;
			}
			throw wrapCursorSdkAuthError(error);
		} finally {
			if (activeCursorRun === run) activeCursorRun = undefined;
		}
	}
	async run(): Promise<CursorRunResult> {
		if (!this.options.timeoutMs || this.options.timeoutMs <= 0) return this.execute();
		await this.options.onDeadlineStart?.();
		try {
			return await withRunTimeout(() => this.execute(), this.options.timeoutMs, {
				onTimeout: () => {
					this.timedOut = true;
					cancelSdkRun(activeCursorRun);
				},
			});
		} catch (error) {
			if (error instanceof AgentRunTimeoutError)
				error.trace = error.trace ?? takeLastCursorRunTrace();
			throw error;
		}
	}
}
/** Shared Cursor SDK path with one owner for stream, deadline, and cancellation. */
export async function runCursorAgent(options: CursorRunOptions): Promise<CursorRunResult> {
	const authMode = resolveCursorAuthMode(undefined, options.apiKey, options.authMode);
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (authMode === "api-key" && !apiKey?.trim()) throw new Error(CURSOR_MISSING_KEY_MESSAGE);
	const sdkModule = await import("@cursor/sdk");
	const modelId = options.model?.id ?? process.env.CURSOR_AGENT_MODEL ?? DEFAULT_CURSOR_MODEL;
	const mcpServers = resolveMcpServers(options.mcpServers, { cwd: options.cwd });
	const execute = async () => {
		await using agent = await sdkModule.Agent.create({
			model: { id: modelId },
			local: {
				cwd: options.cwd,
				settingSources: cursorSettingSources(options.includeGlobalSkills === true),
			},
			...(mcpServers ? { mcpServers } : {}),
			...(authMode === "api-key" && apiKey ? { apiKey } : {}),
		});
		return await new CursorExecution(options, agent).run();
	};
	try {
		return await withCursorAuthEnv(authMode, () =>
			withCursorUserHome(options.includeGlobalSkills === true, () =>
				withProcessWorkingDirectory(options.cwd, execute),
			),
		);
	} catch (error) {
		throw wrapCursorSdkAuthError(error);
	}
}

/** Classifier-only judge path — one-shot Agent.prompt, JSON reply, temperature 0 when supported. */

function extractCursorSdkError(error: unknown): CursorSdkError | undefined {
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
