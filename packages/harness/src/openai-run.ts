import { type ChildProcess, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { type HostAuthMode, resolveKeyOrLoginAuthMode } from "./auth-mode.js";
import type { JudgeClassifierResult } from "./cursor-run.js";
import { createLiveNotifyState, emitLiveAgentEvents } from "./live-agent-event.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import {
	accumulateOpenaiEvent,
	createOpenaiTraceAccumulator,
	finalizeOpenaiTraceAccumulator,
	lastAssistantText,
	type OpenaiTraceAccumulator,
	parseOpenaiJsonlLine,
} from "./openai-capture.js";
import {
	AgentRunTimeoutError,
	getPartialTrace,
	isUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "./run-guards.js";
import type { AgentTrace, LiveAgentEvent } from "./types.js";
import { openaiUserConfigArgs } from "./user-skills.js";

export type OpenaiAuthMode = HostAuthMode;

export const OPENAI_AUTH_MODE_ENV = "OPENAI_AUTH_MODE";

export const OPENAI_MISSING_KEY_MESSAGE =
	"OPENAI_API_KEY or CODEX_API_KEY required for OpenAI agent runs, or set OPENAI_AUTH_MODE=subscription after `codex login`";

export function resolveOpenaiAuthMode(
	raw: string | undefined = process.env[OPENAI_AUTH_MODE_ENV],
	apiKey?: string,
): OpenaiAuthMode {
	return resolveKeyOrLoginAuthMode({
		envName: OPENAI_AUTH_MODE_ENV,
		raw,
		hasApiKey: Boolean((apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY)?.trim()),
		missingKeyMessage: OPENAI_MISSING_KEY_MESSAGE,
	});
}

export interface OpenaiRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	authMode?: OpenaiAuthMode;
	model?: string;
	timeoutMs?: number;
	failOnUserInput?: boolean;
	onDeadlineStart?: () => void | Promise<void>;
	onAgentEvent?: (event: LiveAgentEvent) => void;
	bin?: string;
	/** `workspace-write` for agent runs; `read-only` for classifiers. */
	sandbox?: "workspace-write" | "read-only";
	/** Inline MCP servers for this `codex exec` via `-c mcp_servers.<name>=…`. */
	mcpServers?: Record<string, McpServerConfig>;
	/** Load `~/.codex` user config and skills. Default false. */
	allowUserSkills?: boolean;
}

export interface OpenaiRunResult {
	status: "completed" | "failed";
	trace: AgentTrace;
	rawStatus?: string;
	exitCode?: number | null;
	stderr?: string;
}

interface OpenaiChildProcess extends ChildProcess {
	stdout: Readable;
	stderr: Readable;
}

interface ActiveOpenaiChild {
	child: OpenaiChildProcess;
	acc: OpenaiTraceAccumulator;
	abort: AbortController;
}

let activeOpenaiRun: ActiveOpenaiChild | undefined;
let lastOpenaiRunTrace: AgentTrace | undefined;

function stashTrace(acc: OpenaiTraceAccumulator): AgentTrace {
	const trace = finalizeOpenaiTraceAccumulator(acc);
	lastOpenaiRunTrace = trace;
	return trace;
}

export function cancelActiveOpenaiRun(): void {
	const active = activeOpenaiRun;
	activeOpenaiRun = undefined;
	if (!active) {
		return;
	}
	active.abort.abort();
	killOpenaiChild(active.child);
}

export function takeLastOpenaiRunTrace(): AgentTrace | undefined {
	const trace = lastOpenaiRunTrace;
	lastOpenaiRunTrace = undefined;
	return trace;
}

export function formatOpenaiRunFailure(options: {
	status: string;
	rawStatus?: string;
	exitCode?: number | null;
	stderr?: string;
	resultError?: string;
}): string {
	const details: string[] = [];
	if (options.rawStatus) {
		details.push(`cli: ${options.rawStatus}`);
	}
	if (options.exitCode !== undefined && options.exitCode !== null) {
		details.push(`exit: ${options.exitCode}`);
	}
	if (options.resultError) {
		details.push(`error: ${options.resultError}`);
	} else if (options.stderr?.trim()) {
		const compact = options.stderr.trim().replace(/\s+/g, " ").slice(0, 240);
		details.push(`stderr: ${compact}`);
	}
	const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
	return `openai run status: ${options.status}${suffix}`;
}

function destroyChildPipes(child: OpenaiChildProcess): void {
	try {
		child.stdout.destroy();
	} catch {
		// best-effort
	}
	try {
		child.stderr.destroy();
	} catch {
		// best-effort
	}
}

function killOpenaiChild(child: OpenaiChildProcess): void {
	destroyChildPipes(child);
	try {
		child.kill("SIGTERM");
	} catch {
		// best-effort
	}
	const pid = child.pid;
	if (pid === undefined || pid <= 0 || process.platform === "win32") {
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		// best-effort
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function resolveOpenaiBin(override?: string): Promise<string> {
	const candidate = override?.trim() || process.env.CODEX_BIN?.trim() || "codex";
	if (candidate.includes("/") || candidate.includes("\\")) {
		if (!(await pathExists(candidate))) {
			throw new Error(`OpenAI Codex binary not found at ${candidate}`);
		}
	}
	return candidate;
}

/**
 * Child env for the Codex CLI. Subscription mode drops API keys:
 * the CLI prefers a key over the `codex login` ChatGPT session.
 */
export function buildOpenaiEnv(authMode: OpenaiAuthMode, apiKey?: string): NodeJS.ProcessEnv {
	if (authMode === "api-key") {
		const key = apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
		if (!key) {
			return { ...process.env };
		}
		return { ...process.env, OPENAI_API_KEY: key, CODEX_API_KEY: key };
	}
	const env = { ...process.env };
	delete env.OPENAI_API_KEY;
	delete env.CODEX_API_KEY;
	return env;
}

export function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One `-c mcp_servers.name={…}` override for `codex exec`. */
export function buildOpenaiMcpOverride(name: string, config: McpServerConfig): string {
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
		throw new Error(`OpenAI MCP server name must be a TOML key: ${name}`);
	}
	if ("command" in config && config.command) {
		const parts = [`command=${tomlString(config.command)}`];
		if (config.args && config.args.length > 0) {
			parts.push(`args=[${config.args.map((arg) => tomlString(arg)).join(",")}]`);
		}
		if (config.cwd) {
			parts.push(`cwd=${tomlString(config.cwd)}`);
		}
		if (config.env && Object.keys(config.env).length > 0) {
			const env = Object.entries(config.env)
				.map(([key, value]) => `${key}=${tomlString(value)}`)
				.join(",");
			parts.push(`env={${env}}`);
		}
		// Codex 0.154+ rejects MCP calls when approval_policy=never unless
		// the server auto-approves tools.
		parts.push('default_tools_approval_mode="approve"');
		return `mcp_servers.${name}={${parts.join(",")}}`;
	}
	if ("url" in config && config.url) {
		return `mcp_servers.${name}={url=${tomlString(config.url)},default_tools_approval_mode="approve"}`;
	}
	throw new Error(`OpenAI MCP server "${name}" needs a command or url`);
}

export function buildOpenaiMcpConfigArgs(
	servers: Record<string, McpServerConfig> | undefined,
): string[] {
	if (!servers || Object.keys(servers).length === 0) {
		return [];
	}
	const args: string[] = [];
	for (const [name, config] of Object.entries(servers)) {
		args.push("-c", buildOpenaiMcpOverride(name, config));
	}
	return args;
}

export function buildOpenaiExecArgs(options: {
	prompt: string;
	cwd: string;
	model?: string;
	sandbox?: "workspace-write" | "read-only";
	mcpServers?: Record<string, McpServerConfig>;
	allowUserSkills?: boolean;
}): string[] {
	const sandbox = options.sandbox ?? "workspace-write";
	const args = [
		"exec",
		"--json",
		"--sandbox",
		sandbox,
		"--cd",
		options.cwd,
		// Deny keeps ~/.codex/config.toml out. Auth still uses CODEX_HOME.
		// A user model pin (for example gpt-5.6-luna) can fail older Codex CLIs.
		...openaiUserConfigArgs(options.allowUserSkills === true),
		// Headless default is never. Set it explicitly so a leftover config
		// cannot prompt, and so we do not need --approve-for-me (Codex >= 0.147).
		"-c",
		"approval_policy=never",
	];
	args.push(...buildOpenaiMcpConfigArgs(options.mcpServers));
	const model =
		options.model?.trim() ||
		process.env.CODEX_AGENT_MODEL?.trim() ||
		process.env.OPENAI_AGENT_MODEL?.trim();
	if (model) {
		args.push("--model", model);
	}
	args.push(options.prompt);
	return args;
}

async function drainJsonl(
	child: OpenaiChildProcess,
	acc: OpenaiTraceAccumulator,
	failOnUserInput: boolean,
	signal: AbortSignal,
	onAgentEvent?: (event: LiveAgentEvent) => void,
): Promise<{ exitCode: number | null; stderr: string }> {
	const liveState = createLiveNotifyState();
	const stderrChunks: string[] = [];
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderrChunks.push(chunk);
	});

	const spawnError = new Promise<never>((_, reject) => {
		child.once("error", reject);
	});

	const aborted = new Promise<never>((_, reject) => {
		const fail = () => {
			destroyChildPipes(child);
			reject(new AgentRunTimeoutError(0));
		};
		if (signal.aborted) {
			fail();
			return;
		}
		signal.addEventListener("abort", fail, { once: true });
	});

	const readStdout = async (): Promise<void> => {
		const rl = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
		try {
			for await (const line of rl) {
				if (signal.aborted) {
					break;
				}
				const event = parseOpenaiJsonlLine(line);
				if (!event) {
					continue;
				}
				accumulateOpenaiEvent(acc, event);
				emitLiveAgentEvents(acc, liveState, onAgentEvent);
				stashTrace(acc);
				const lastTool = acc.toolCalls.at(-1);
				if (lastTool && isUserInputTool(lastTool.name)) {
					if (failOnUserInput) {
						const userInputError = new UserInputRequiredError(lastTool.name);
						userInputError.trace = stashTrace(acc);
						killOpenaiChild(child);
						throw userInputError;
					}
					killOpenaiChild(child);
					break;
				}
			}
		} finally {
			rl.close();
		}
	};

	const waitClose = new Promise<number | null>((resolve) => {
		child.once("close", (code) => resolve(code));
	});

	try {
		const settled = await Promise.race([
			spawnError,
			aborted,
			Promise.all([readStdout(), waitClose]).then(([, exitCode]) => ({ exitCode })),
		]);
		return { exitCode: settled.exitCode, stderr: stderrChunks.join("") };
	} catch (error) {
		killOpenaiChild(child);
		throw error;
	}
}

/** Shared Codex CLI path — `codex exec --json` → AgentTrace. */
export async function runOpenaiAgent(options: OpenaiRunOptions): Promise<OpenaiRunResult> {
	const authMode = options.authMode ?? resolveOpenaiAuthMode(undefined, options.apiKey);
	const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
	if (authMode === "api-key" && !apiKey?.trim()) {
		throw new Error(OPENAI_MISSING_KEY_MESSAGE);
	}
	const bin = await resolveOpenaiBin(options.bin);
	let timedOut = false;
	const args = buildOpenaiExecArgs({
		prompt: options.prompt,
		cwd: options.cwd,
		model: options.model,
		sandbox: options.sandbox,
		mcpServers: resolveMcpServers(options.mcpServers, { cwd: options.cwd }),
		allowUserSkills: options.allowUserSkills === true,
	});

	const execute = async (): Promise<OpenaiRunResult> => {
		const acc = createOpenaiTraceAccumulator();
		const abort = new AbortController();
		const child = spawn(bin, args, {
			cwd: options.cwd,
			env: buildOpenaiEnv(authMode, options.apiKey),
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		}) as OpenaiChildProcess;

		activeOpenaiRun = { child, acc, abort };
		if (timedOut) {
			abort.abort();
			killOpenaiChild(child);
			activeOpenaiRun = undefined;
			const timeoutError = new AgentRunTimeoutError(options.timeoutMs ?? 0);
			timeoutError.trace = stashTrace(acc);
			throw timeoutError;
		}

		try {
			const { exitCode, stderr } = await drainJsonl(
				child,
				acc,
				options.failOnUserInput !== false,
				abort.signal,
				options.onAgentEvent,
			);
			const trace = stashTrace(acc);
			const rawStatus = acc.rawStatus ?? (exitCode === 0 ? "success" : "error");
			const failed =
				(exitCode !== null && exitCode !== 0) || rawStatus === "error" || Boolean(acc.resultError);
			return {
				status: failed ? "failed" : "completed",
				trace,
				rawStatus,
				exitCode,
				stderr: stderr || undefined,
			};
		} catch (error) {
			abort.abort();
			killOpenaiChild(child);
			const partial = stashTrace(acc);
			if (error instanceof AgentRunTimeoutError || error instanceof UserInputRequiredError) {
				error.trace = error.trace ?? partial;
				throw error;
			}
			if (error && typeof error === "object" && "code" in error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					throw new Error(
						`OpenAI Codex binary not found (${bin}). Install the Codex CLI or set CODEX_BIN.`,
					);
				}
			}
			throw error;
		} finally {
			if (activeOpenaiRun?.child === child) {
				activeOpenaiRun = undefined;
			}
		}
	};

	if (options.timeoutMs && options.timeoutMs > 0) {
		await options.onDeadlineStart?.();
		try {
			return await withRunTimeout(execute, options.timeoutMs, {
				onTimeout: () => {
					timedOut = true;
					cancelActiveOpenaiRun();
				},
			});
		} catch (error) {
			if (error instanceof AgentRunTimeoutError) {
				error.trace = error.trace ?? takeLastOpenaiRunTrace() ?? getPartialTrace(error);
			}
			throw error;
		}
	}

	return execute();
}

/** Classifier-only Codex path — read-only sandbox, last assistant text. */
export async function runOpenaiClassifier(options: {
	cwd: string;
	prompt: string;
	apiKey?: string;
	bin?: string;
}): Promise<JudgeClassifierResult> {
	const result = await runOpenaiAgent({
		cwd: options.cwd,
		prompt: options.prompt,
		apiKey: options.apiKey,
		bin: options.bin,
		sandbox: "read-only",
		failOnUserInput: true,
	});
	return {
		status: result.status,
		text: lastAssistantText(result.trace),
		rawStatus: result.rawStatus,
		sdkError: result.trace.artifacts.openaiResultError
			? { message: result.trace.artifacts.openaiResultError }
			: undefined,
		usage: result.trace.usage,
	};
}
