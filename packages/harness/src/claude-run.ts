import { type ChildProcess, spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import {
	accumulateClaudeEvent,
	type ClaudeTraceAccumulator,
	createClaudeTraceAccumulator,
	finalizeClaudeTraceAccumulator,
	parseClaudeNdjsonLine,
} from "./claude-capture.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import {
	AgentRunTimeoutError,
	getPartialTrace,
	isUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "./run-guards.js";
import type { AgentTrace } from "./types.js";

const DEFAULT_ALLOWED_TOOLS = "Bash,Read,Edit,Write,Glob,Grep,Agent";

export interface ClaudeRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: string;
	mcpServers?: Record<string, McpServerConfig>;
	/** Hard cap on the CLI process; omit for no harness deadline. */
	timeoutMs?: number;
	/** Fail fast when the agent invokes AskUserQuestion-style tools (default true). */
	failOnUserInput?: boolean;
	/** Fires immediately before the harness deadline timer arms (after spawn setup). */
	onDeadlineStart?: () => void | Promise<void>;
	/** Override binary path; defaults to CLAUDE_CODE_BIN or `claude`. */
	bin?: string;
	/** Override --allowedTools; defaults to CLAUDE_CODE_ALLOWED_TOOLS or built-in list. */
	allowedTools?: string;
	/** Auth mode; when omitted it is read from CLAUDE_AUTH_MODE (which is required). */
	authMode?: ClaudeAuthMode;
}

export interface ClaudeRunResult {
	status: "completed" | "failed";
	trace: AgentTrace;
	rawStatus?: string;
	exitCode?: number | null;
	stderr?: string;
}

interface ClaudeChildProcess extends ChildProcess {
	stdout: Readable;
	stderr: Readable;
}

interface ActiveClaudeChild {
	child: ClaudeChildProcess;
	acc: ClaudeTraceAccumulator;
	abort: AbortController;
}

let activeClaudeRun: ActiveClaudeChild | undefined;
let lastClaudeRunTrace: AgentTrace | undefined;

function stashTrace(acc: ClaudeTraceAccumulator): AgentTrace {
	const trace = finalizeClaudeTraceAccumulator(acc);
	lastClaudeRunTrace = trace;
	return trace;
}

/** Best-effort cancel of the in-flight Claude CLI process (no-op when idle). */
export function cancelActiveClaudeRun(): void {
	const active = activeClaudeRun;
	activeClaudeRun = undefined;
	if (!active) {
		return;
	}
	active.abort.abort();
	killClaudeChild(active.child);
}

/** Consume the most recent partial/full Claude trace (clears the stash). */
export function takeLastClaudeRunTrace(): AgentTrace | undefined {
	const trace = lastClaudeRunTrace;
	lastClaudeRunTrace = undefined;
	return trace;
}

export function formatClaudeRunFailure(options: {
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
	return `claude run status: ${options.status}${suffix}`;
}

function destroyChildPipes(child: ClaudeChildProcess): void {
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

function killClaudeChild(child: ClaudeChildProcess): void {
	destroyChildPipes(child);
	try {
		child.kill("SIGTERM");
	} catch {
		// best-effort
	}
	const pid = child.pid;
	// pid <= 0 is invalid / special (0 = caller's process group) — never group-kill it.
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

/** Resolve Claude Code binary from options / env / PATH name. */
export async function resolveClaudeBin(override?: string): Promise<string> {
	const candidate = override?.trim() || process.env.CLAUDE_CODE_BIN?.trim() || "claude";
	if (candidate.includes("/") || candidate.includes("\\")) {
		if (!(await pathExists(candidate))) {
			throw new Error(`Claude Code binary not found at ${candidate}`);
		}
	}
	return candidate;
}

/**
 * Child env for the CLI. In subscription mode ANTHROPIC_API_KEY is stripped:
 * the CLI prefers a key over OAuth, so a stale one in the parent shell would
 * silently bill the API instead of the plan.
 */
export function buildClaudeEnv(authMode: ClaudeAuthMode, apiKey?: string): NodeJS.ProcessEnv {
	if (authMode === "api-key") {
		return { ...process.env, ANTHROPIC_API_KEY: apiKey };
	}
	const env = { ...process.env };
	delete env.ANTHROPIC_API_KEY;
	return env;
}

function resolveAllowedTools(override?: string): string {
	return override?.trim() || process.env.CLAUDE_CODE_ALLOWED_TOOLS?.trim() || DEFAULT_ALLOWED_TOOLS;
}

/** Convert harness MCP configs into Claude CLI `--mcp-config` JSON. */
export function buildClaudeMcpConfigJson(
	servers: Record<string, McpServerConfig>,
): Record<string, unknown> {
	const mcpServers: Record<string, unknown> = {};
	for (const [name, config] of Object.entries(servers)) {
		if ("command" in config && config.command) {
			mcpServers[name] = {
				command: config.command,
				...(config.args ? { args: config.args } : {}),
				...(config.env ? { env: config.env } : {}),
				...(config.cwd ? { cwd: config.cwd } : {}),
			};
			continue;
		}
		if ("url" in config && config.url) {
			mcpServers[name] = {
				type: config.type ?? "http",
				url: config.url,
				...(config.headers ? { headers: config.headers } : {}),
			};
		}
	}
	return { mcpServers };
}

async function writeMcpConfigFile(
	servers: Record<string, McpServerConfig> | undefined,
	cwd: string,
): Promise<{ path: string; dir: string } | undefined> {
	const resolved = resolveMcpServers(servers, { cwd });
	if (!resolved) {
		return undefined;
	}
	const dir = await mkdtemp(join(tmpdir(), "agent-harness-claude-mcp-"));
	const path = join(dir, "mcp.json");
	await writeFile(path, `${JSON.stringify(buildClaudeMcpConfigJson(resolved), null, 2)}\n`, "utf8");
	return { path, dir };
}

/**
 * How the spawned CLI authenticates. Always selected explicitly — there is no
 * default and no fallback between the two.
 *
 *   "api-key"      — ANTHROPIC_API_KEY, metered API billing. Uses `--bare`.
 *   "subscription" — the user's Claude plan, via OAuth in the keychain or
 *                    CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`.
 *
 * `--bare` never reads OAuth or the keychain (it exists to make CI runs
 * reproducible), so subscription auth has to drop it. Dropping `--bare` lets
 * the host's own hooks, plugins and CLAUDE.md into the run, so this mode is
 * less hermetic than the API-key one — `--strict-mcp-config` at least keeps
 * the MCP surface to the servers the scenario declared.
 */
export type ClaudeAuthMode = "api-key" | "subscription";

export const CLAUDE_AUTH_MODE_ENV = "CLAUDE_AUTH_MODE";

const CLAUDE_AUTH_MODES: ClaudeAuthMode[] = ["api-key", "subscription"];

/**
 * Parse an explicit auth-mode selection. Throws on anything else: an unset or
 * misspelled value must never silently pick a mode, because the two bill
 * different accounts.
 */
export function parseClaudeAuthMode(raw: string | undefined): ClaudeAuthMode {
	const value = raw?.trim();
	if (!value) {
		throw new Error(
			`${CLAUDE_AUTH_MODE_ENV} not set — choose ${CLAUDE_AUTH_MODES.join(" or ")} (no default)`,
		);
	}
	if (!(CLAUDE_AUTH_MODES as string[]).includes(value)) {
		throw new Error(
			`${CLAUDE_AUTH_MODE_ENV}="${value}" is invalid — choose ${CLAUDE_AUTH_MODES.join(" or ")}`,
		);
	}
	return value as ClaudeAuthMode;
}

function buildClaudeArgs(options: {
	prompt: string;
	model?: string;
	allowedTools: string;
	mcpConfigPath?: string;
	authMode: ClaudeAuthMode;
}): string[] {
	const args = [
		"-p",
		options.prompt,
		...(options.authMode === "api-key" ? ["--bare"] : ["--strict-mcp-config"]),
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"acceptEdits",
		"--allowedTools",
		options.allowedTools,
	];
	const model = options.model?.trim() || process.env.CLAUDE_AGENT_MODEL?.trim();
	if (model) {
		args.push("--model", model);
	}
	if (options.mcpConfigPath) {
		args.push("--mcp-config", options.mcpConfigPath);
	}
	return args;
}

async function drainNdjson(
	child: ClaudeChildProcess,
	acc: ClaudeTraceAccumulator,
	failOnUserInput: boolean,
	signal: AbortSignal,
): Promise<{ exitCode: number | null; stderr: string }> {
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
				const event = parseClaudeNdjsonLine(line);
				if (!event) {
					continue;
				}
				accumulateClaudeEvent(acc, event);
				stashTrace(acc);
				if (failOnUserInput) {
					const lastTool = acc.toolCalls.at(-1);
					if (lastTool && isUserInputTool(lastTool.name)) {
						const userInputError = new UserInputRequiredError(lastTool.name);
						userInputError.trace = stashTrace(acc);
						killClaudeChild(child);
						throw userInputError;
					}
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
		killClaudeChild(child);
		throw error;
	}
}

/** Shared Claude Code CLI path — spawn + stream-json → AgentTrace. */
export async function runClaudeAgent(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
	const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
	const authMode = options.authMode ?? parseClaudeAuthMode(process.env[CLAUDE_AUTH_MODE_ENV]);
	if (authMode === "api-key" && !apiKey?.trim()) {
		throw new Error(`${CLAUDE_AUTH_MODE_ENV}=api-key but ANTHROPIC_API_KEY is not set`);
	}

	const bin = await resolveClaudeBin(options.bin);
	const allowedTools = resolveAllowedTools(options.allowedTools);
	let mcpConfigDir: string | undefined;
	let timedOut = false;

	try {
		const mcpConfig = await writeMcpConfigFile(options.mcpServers, options.cwd);
		mcpConfigDir = mcpConfig?.dir;
		const args = buildClaudeArgs({
			prompt: options.prompt,
			model: options.model,
			allowedTools,
			mcpConfigPath: mcpConfig?.path,
			authMode,
		});

		const execute = async (): Promise<ClaudeRunResult> => {
			const acc = createClaudeTraceAccumulator();
			const abort = new AbortController();
			const child = spawn(bin, args, {
				cwd: options.cwd,
				env: buildClaudeEnv(authMode, apiKey),
				stdio: ["ignore", "pipe", "pipe"],
				detached: process.platform !== "win32",
			}) as ClaudeChildProcess;

			activeClaudeRun = { child, acc, abort };
			if (timedOut) {
				abort.abort();
				killClaudeChild(child);
				activeClaudeRun = undefined;
				const timeoutError = new AgentRunTimeoutError(options.timeoutMs ?? 0);
				timeoutError.trace = stashTrace(acc);
				throw timeoutError;
			}

			try {
				const { exitCode, stderr } = await drainNdjson(
					child,
					acc,
					options.failOnUserInput !== false,
					abort.signal,
				);
				const trace = stashTrace(acc);
				const rawStatus =
					acc.rawStatus ?? (exitCode === 0 && !acc.resultIsError ? "success" : "error");
				const failed =
					acc.resultIsError ||
					(exitCode !== null && exitCode !== 0) ||
					rawStatus === "error" ||
					Boolean(acc.resultError);

				if (!failed) {
					return {
						status: "completed",
						trace,
						rawStatus,
						exitCode,
						stderr: stderr || undefined,
					};
				}

				return {
					status: "failed",
					trace,
					rawStatus,
					exitCode,
					stderr: stderr || undefined,
				};
			} catch (error) {
				abort.abort();
				killClaudeChild(child);
				const partial = stashTrace(acc);
				if (error instanceof AgentRunTimeoutError || error instanceof UserInputRequiredError) {
					error.trace = error.trace ?? partial;
					throw error;
				}
				if (error && typeof error === "object" && "code" in error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "ENOENT") {
						throw new Error(
							`Claude Code binary not found (${bin}). Install Claude Code CLI or set CLAUDE_CODE_BIN.`,
						);
					}
				}
				throw error;
			} finally {
				if (activeClaudeRun?.child === child) {
					activeClaudeRun = undefined;
				}
			}
		};

		if (options.timeoutMs && options.timeoutMs > 0) {
			await options.onDeadlineStart?.();
			try {
				return await withRunTimeout(execute, options.timeoutMs, {
					onTimeout: () => {
						timedOut = true;
						cancelActiveClaudeRun();
					},
				});
			} catch (error) {
				if (error instanceof AgentRunTimeoutError) {
					error.trace = error.trace ?? takeLastClaudeRunTrace() ?? getPartialTrace(error);
				}
				throw error;
			}
		}

		return execute();
	} finally {
		if (mcpConfigDir) {
			await rm(mcpConfigDir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
