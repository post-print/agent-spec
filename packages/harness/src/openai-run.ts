import { type ChildProcess, spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { type HostAuthMode, resolveKeyOrLoginAuthMode } from "./auth-mode.js";
import { createLiveNotifyState, emitLiveAgentEvents } from "./live-agent-event.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import {
	accumulateOpenaiEvent,
	createOpenaiTraceAccumulator,
	finalizeOpenaiTraceAccumulator,
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

const ENV_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export type OpenaiAuthMode = HostAuthMode;

export const OPENAI_AUTH_MODE_ENV = "OPENAI_AUTH_MODE";

export const OPENAI_MISSING_KEY_MESSAGE =
	"OPENAI_API_KEY or CODEX_API_KEY required for --auth-mode api-key";

export function resolveOpenaiAuthMode(
	raw: string | undefined = process.env[OPENAI_AUTH_MODE_ENV],
	apiKey?: string,
	explicit?: OpenaiAuthMode,
): OpenaiAuthMode {
	return resolveKeyOrLoginAuthMode({
		envName: OPENAI_AUTH_MODE_ENV,
		raw,
		hasApiKey: Boolean((apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY)?.trim()),
		missingKeyMessage: OPENAI_MISSING_KEY_MESSAGE,
		explicit,
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
	includeGlobalSkills?: boolean;
	/** Allow network access in a workspace-write sandbox. Default false. */
	networkAccess?: boolean;
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

interface OpenaiRunHome {
	home: string;
	codexHome: string;
	cleanup: () => Promise<void>;
}

/** A clean home with only the Codex login file. */
export async function createOpenaiRunHome(options?: {
	realHome?: string;
	realCodexHome?: string;
}): Promise<OpenaiRunHome> {
	const realHome = options?.realHome ?? homedir();
	const realCodexHome =
		options?.realCodexHome ?? process.env.CODEX_HOME ?? join(realHome, ".codex");
	const home = await mkdtemp(join(tmpdir(), "agent-harness-openai-home-"));
	const codexHome = join(home, ".codex");
	await mkdir(codexHome, { recursive: true });
	try {
		await copyFile(join(realCodexHome, "auth.json"), join(codexHome, "auth.json"));
	} catch {
		// API-key runs and logged-out checks do not have a login file.
	}
	return {
		home,
		codexHome,
		cleanup: async () => {
			await rm(home, { recursive: true, force: true });
		},
	};
}

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
	const { OPENAI_API_KEY: _openaiKey, CODEX_API_KEY: _codexKey, ...env } = process.env;
	return env;
}

export function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** One `-c mcp_servers.name={…}` override for `codex exec`. */
export function buildOpenaiMcpOverride(name: string, config: McpServerConfig): string {
	if (!ENV_NAME.test(name)) {
		throw new Error(`OpenAI MCP server name must be a TOML key: ${name}`);
	}
	if ("command" in config && config.command) {
		return openaiStdioMcp(name, config);
	}
	if ("url" in config && config.url) {
		return `mcp_servers.${name}={url=${tomlString(config.url)},default_tools_approval_mode="approve"}`;
	}
	throw new Error(`OpenAI MCP server "${name}" needs a command or url`);
}

function openaiStdioMcp(
	name: string,
	config: Extract<McpServerConfig, { command: string }>,
): string {
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
	includeGlobalSkills?: boolean;
	networkAccess?: boolean;
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
		...openaiUserConfigArgs(options.includeGlobalSkills === true),
		// Headless default is never. Set it explicitly so a leftover config
		// cannot prompt, and so we do not need --approve-for-me (Codex >= 0.147).
		"-c",
		"approval_policy=never",
	];
	if (sandbox === "read-only") args.push("--skip-git-repo-check");
	if (sandbox === "workspace-write" && options.networkAccess === true) {
		args.push("-c", "sandbox_workspace_write.network_access=true");
	}
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

interface OpenaiStream {
	child: OpenaiChildProcess;
	acc: OpenaiTraceAccumulator;
	failOnUserInput: boolean;
	signal: AbortSignal;
	onAgentEvent?: (event: LiveAgentEvent) => void;
}
function stopOpenaiForInput(stream: OpenaiStream): boolean {
	const { child, acc, failOnUserInput } = stream;
	const lastTool = acc.toolCalls.at(-1);
	if (!lastTool || !isUserInputTool(lastTool.name)) return false;
	killOpenaiChild(child);
	if (failOnUserInput) {
		const error = new UserInputRequiredError(lastTool.name);
		error.trace = stashTrace(acc);
		throw error;
	}
	return true;
}
async function readOpenaiOutput(stream: OpenaiStream): Promise<void> {
	const { child, acc, signal, onAgentEvent } = stream;
	const liveState = createLiveNotifyState();

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
			if (stopOpenaiForInput(stream)) break;
		}
	} finally {
		rl.close();
	}
}
async function drainJsonl(
	stream: OpenaiStream,
): Promise<{ exitCode: number | null; stderr: string }> {
	const { child, signal } = stream;
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

	const waitClose = new Promise<number | null>((resolve) => {
		child.once("close", (code) => resolve(code));
	});

	try {
		const settled = await Promise.race([
			spawnError,
			aborted,
			Promise.all([readOpenaiOutput(stream), waitClose]).then(([, exitCode]) => ({ exitCode })),
		]);
		return { exitCode: settled.exitCode, stderr: stderrChunks.join("") };
	} catch (error) {
		killOpenaiChild(child);
		throw error;
	}
}

interface OpenaiExecution {
	bin: string;
	args: string[];
	authMode: OpenaiAuthMode;
	deadline: { timedOut: boolean };
	runHome: Awaited<ReturnType<typeof createOpenaiRunHome>> | undefined;
}
async function finishOpenaiRun(
	options: OpenaiRunOptions,
	stream: OpenaiStream,
): Promise<OpenaiRunResult> {
	const { child, acc, signal, onAgentEvent } = stream;
	const { exitCode, stderr } = await drainJsonl({
		child,
		acc,
		failOnUserInput: options.failOnUserInput !== false,
		signal,
		onAgentEvent,
	});
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
}
function throwOpenaiRunError(error: unknown, acc: OpenaiTraceAccumulator, bin: string): never {
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
}
async function executeOpenaiRun(
	options: OpenaiRunOptions,
	execution: OpenaiExecution,
): Promise<OpenaiRunResult> {
	const { bin, args, authMode, deadline, runHome } = execution;

	const acc = createOpenaiTraceAccumulator();
	const abort = new AbortController();
	const env = buildOpenaiEnv(authMode, options.apiKey);
	if (runHome) {
		env.HOME = runHome.home;
		env.USERPROFILE = runHome.home;
		env.CODEX_HOME = runHome.codexHome;
	}
	const child = spawn(bin, args, {
		cwd: options.cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: process.platform !== "win32" && process.env.AGENT_HARNESS_SESSION_WORKER !== "1",
	}) as OpenaiChildProcess;

	activeOpenaiRun = { child, acc, abort };
	if (deadline.timedOut) {
		abort.abort();
		killOpenaiChild(child);
		activeOpenaiRun = undefined;
		const timeoutError = new AgentRunTimeoutError(options.timeoutMs ?? 0);
		timeoutError.trace = stashTrace(acc);
		throw timeoutError;
	}

	try {
		return await finishOpenaiRun(options, {
			child,
			acc,
			failOnUserInput: options.failOnUserInput !== false,
			signal: abort.signal,
			onAgentEvent: options.onAgentEvent,
		});
	} catch (error) {
		abort.abort();
		killOpenaiChild(child);
		return throwOpenaiRunError(error, acc, bin);
	} finally {
		if (activeOpenaiRun?.child === child) {
			activeOpenaiRun = undefined;
		}
	}
}

async function runOpenaiWithDeadline(
	options: OpenaiRunOptions,
	execution: OpenaiExecution,
): Promise<OpenaiRunResult> {
	const execute = () => executeOpenaiRun(options, execution);

	if (options.timeoutMs && options.timeoutMs > 0) {
		await options.onDeadlineStart?.();
		try {
			return await withRunTimeout(execute, options.timeoutMs, {
				onTimeout: () => {
					execution.deadline.timedOut = true;
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
	return await execute();
}
/** Shared Codex CLI path — `codex exec --json` → AgentTrace. */
export async function runOpenaiAgent(options: OpenaiRunOptions): Promise<OpenaiRunResult> {
	const authMode = resolveOpenaiAuthMode(undefined, options.apiKey, options.authMode);
	const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
	if (authMode === "api-key" && !apiKey?.trim()) {
		throw new Error(OPENAI_MISSING_KEY_MESSAGE);
	}
	const bin = await resolveOpenaiBin(options.bin);
	const deadline = { timedOut: false };
	const args = buildOpenaiExecArgs({
		prompt: options.prompt,
		cwd: options.cwd,
		model: options.model,
		sandbox: options.sandbox,
		mcpServers: resolveMcpServers(options.mcpServers, { cwd: options.cwd }),
		includeGlobalSkills: options.includeGlobalSkills === true,
		networkAccess: options.networkAccess === true,
	});
	const runHome = options.includeGlobalSkills === true ? undefined : await createOpenaiRunHome();

	try {
		return await runOpenaiWithDeadline(options, { bin, args, authMode, deadline, runHome });
	} finally {
		await runHome?.cleanup();
	}
}

/** Classifier-only Codex path — read-only sandbox, last assistant text. */
