import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type AgentHost,
	CLAUDE_AUTH_MODE_ENV,
	CURSOR_AUTH_MODE_ENV,
	getHealthStatus,
	getRegisteredAdapter,
	HEALTH_CHECK_PATH,
	isBuiltinAgentHost,
	OPENAI_AUTH_MODE_ENV,
	parseClaudeAuthMode,
	resolveCursorAuthMode,
	resolveOpenaiAuthMode,
} from "@post-print/agent-harness";

export interface DoctorReport {
	ok: boolean;
	nodeMajor: number;
	nodeOk: boolean;
	cliPresent: boolean;
	cursorApiKeySet: boolean;
	cursorSdkPresent: boolean;
	anthropicApiKeySet: boolean;
	claudeBinPresent: boolean;
	openaiApiKeySet: boolean;
	openaiBinPresent: boolean;
	liveReady: boolean;
	health: typeof HEALTH_CHECK_PATH;
	messages: string[];
}

function binOnPath(override: string | undefined, names: string[]): boolean {
	if (override) {
		try {
			accessSync(override, constants.X_OK);
			return true;
		} catch {
			try {
				accessSync(override, constants.R_OK);
				return true;
			} catch {
				return false;
			}
		}
	}

	const pathEnv = process.env.PATH ?? "";
	const sep = process.platform === "win32" ? ";" : ":";
	for (const dir of pathEnv.split(sep)) {
		if (!dir) {
			continue;
		}
		for (const name of names) {
			try {
				accessSync(join(dir, name), constants.X_OK);
				return true;
			} catch {
				try {
					accessSync(join(dir, name), constants.R_OK);
					return true;
				} catch {
					// continue
				}
			}
		}
	}
	return false;
}

function claudeBinOnPath(): boolean {
	return binOnPath(
		process.env.CLAUDE_CODE_BIN?.trim(),
		process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"],
	);
}

/** Local diagnostics for agent-test install and live-run readiness. */
export function runDoctor(options?: { cliPath?: string }): DoctorReport {
	const messages: string[] = [];
	const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
	const nodeOk = nodeMajor >= 22;
	if (!nodeOk) {
		messages.push(`Node ${process.versions.node} is below the required >=22`);
	} else {
		messages.push(`Node ${process.versions.node}: OK`);
	}

	const cliPath = options?.cliPath ?? join(dirname(fileURLToPath(import.meta.url)), "cli.js");
	const cliCandidates = [cliPath];
	if (cliPath.endsWith(".js")) {
		cliCandidates.push(`${cliPath.slice(0, -3)}.ts`);
	}
	let cliPresent = false;
	let resolvedCli = cliPath;
	for (const candidate of cliCandidates) {
		try {
			accessSync(candidate, constants.R_OK);
			cliPresent = true;
			resolvedCli = candidate;
			break;
		} catch {
			// try next
		}
	}
	if (cliPresent) {
		messages.push(`CLI entry: ${resolvedCli}`);
	} else {
		messages.push(`CLI entry missing at ${cliPath} (run bun run build)`);
	}

	const require = createRequire(import.meta.url);
	try {
		require.resolve("@post-print/agent-harness");
		messages.push("@post-print/agent-harness: resolvable");
	} catch {
		messages.push("@post-print/agent-harness not resolvable");
	}

	let cursorSdkPresent = false;
	try {
		require.resolve("@cursor/sdk");
		cursorSdkPresent = true;
		messages.push("@cursor/sdk: installed (direct Cursor runs ready)");
	} catch {
		messages.push("@cursor/sdk not installed — required for Cursor runs (npm i -D @cursor/sdk)");
	}

	const cursorApiKeySet = Boolean(process.env.CURSOR_API_KEY?.trim());
	if (cursorApiKeySet) {
		messages.push("CURSOR_API_KEY: set");
	} else {
		messages.push("CURSOR_API_KEY unset (required for CURSOR_AUTH_MODE=api-key)");
	}

	const cursorAuthMode = process.env[CURSOR_AUTH_MODE_ENV]?.trim();
	if (cursorAuthMode === "api-key" || cursorAuthMode === "subscription") {
		messages.push(`${CURSOR_AUTH_MODE_ENV}: ${cursorAuthMode}`);
	} else if (cursorAuthMode) {
		messages.push(`${CURSOR_AUTH_MODE_ENV}="${cursorAuthMode}" invalid (api-key or subscription)`);
	} else if (cursorApiKeySet) {
		messages.push(`${CURSOR_AUTH_MODE_ENV} unset (using CURSOR_API_KEY)`);
	} else {
		messages.push(
			`${CURSOR_AUTH_MODE_ENV} unset (set CURSOR_API_KEY or ${CURSOR_AUTH_MODE_ENV}=subscription after Cursor.auth.login())`,
		);
	}

	const anthropicApiKeySet = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
	if (anthropicApiKeySet) {
		messages.push("ANTHROPIC_API_KEY: set");
	} else {
		messages.push("ANTHROPIC_API_KEY unset (required for CLAUDE_AUTH_MODE=api-key)");
	}

	const claudeAuthMode = process.env[CLAUDE_AUTH_MODE_ENV]?.trim();
	if (claudeAuthMode === "api-key" || claudeAuthMode === "subscription") {
		messages.push(`${CLAUDE_AUTH_MODE_ENV}: ${claudeAuthMode}`);
	} else if (claudeAuthMode) {
		messages.push(`${CLAUDE_AUTH_MODE_ENV}="${claudeAuthMode}" invalid (api-key or subscription)`);
	} else {
		messages.push(
			`${CLAUDE_AUTH_MODE_ENV} unset (required for --host claude: api-key or subscription)`,
		);
	}

	const claudeBinPresent = claudeBinOnPath();
	if (claudeBinPresent) {
		messages.push(
			process.env.CLAUDE_CODE_BIN?.trim()
				? `Claude Code binary: ${process.env.CLAUDE_CODE_BIN.trim()}`
				: "Claude Code binary: claude (on PATH)",
		);
	} else {
		messages.push(
			"Claude Code binary not found (install Claude Code CLI or set CLAUDE_CODE_BIN for --host claude)",
		);
	}

	const openaiApiKeySet = Boolean(
		process.env.OPENAI_API_KEY?.trim() || process.env.CODEX_API_KEY?.trim(),
	);
	if (openaiApiKeySet) {
		messages.push("OPENAI_API_KEY or CODEX_API_KEY: set");
	} else {
		messages.push("OPENAI_API_KEY and CODEX_API_KEY unset (required for OPENAI_AUTH_MODE=api-key)");
	}

	const openaiAuthMode = process.env[OPENAI_AUTH_MODE_ENV]?.trim();
	if (openaiAuthMode === "api-key" || openaiAuthMode === "subscription") {
		messages.push(`${OPENAI_AUTH_MODE_ENV}: ${openaiAuthMode}`);
	} else if (openaiAuthMode) {
		messages.push(`${OPENAI_AUTH_MODE_ENV}="${openaiAuthMode}" invalid (api-key or subscription)`);
	} else if (openaiApiKeySet) {
		messages.push(`${OPENAI_AUTH_MODE_ENV} unset (using OPENAI_API_KEY or CODEX_API_KEY)`);
	} else {
		messages.push(
			`${OPENAI_AUTH_MODE_ENV} unset (set a key or ${OPENAI_AUTH_MODE_ENV}=subscription after \`codex login\`)`,
		);
	}

	const openaiBinPresent = binOnPath(
		process.env.CODEX_BIN?.trim(),
		process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"],
	);
	if (openaiBinPresent) {
		messages.push(
			process.env.CODEX_BIN?.trim()
				? `OpenAI Codex binary: ${process.env.CODEX_BIN.trim()}`
				: "OpenAI Codex binary: codex (on PATH)",
		);
	} else {
		messages.push(
			"OpenAI Codex binary not found (install Codex CLI or set CODEX_BIN for --host openai)",
		);
	}

	const cursorLiveReady = missingAgentAuth("cursor") === undefined;
	const claudeLiveReady = missingAgentAuth("claude") === undefined;
	const openaiLiveReady = missingAgentAuth("openai") === undefined;
	const liveReady = cursorLiveReady || claudeLiveReady || openaiLiveReady;

	const health = getHealthStatus();
	const ok = nodeOk && cliPresent && health.ok;
	if (ok) {
		messages.push(`doctor ${HEALTH_CHECK_PATH}: package-ready`);
	}
	if (liveReady) {
		messages.push("doctor host: ready for at least one host");
	} else {
		messages.push("doctor host: not ready (no host credentials)");
	}

	return {
		ok,
		nodeMajor,
		nodeOk,
		cliPresent,
		cursorApiKeySet,
		cursorSdkPresent,
		anthropicApiKeySet,
		claudeBinPresent,
		openaiApiKeySet,
		openaiBinPresent,
		liveReady,
		health: HEALTH_CHECK_PATH,
		messages,
	};
}

/** Missing credential or binary for a live host adapter. Undefined when that host can run. */
export function missingAgentAuth(host: AgentHost): string | undefined {
	if (!isBuiltinAgentHost(host)) {
		const adapter = getRegisteredAdapter(host);
		if (!adapter) {
			return `Unknown host "${host}". Register it with registerHostAdapter() or --adapter.`;
		}
		return adapter.missingAuth?.();
	}
	if (host === "claude") {
		const raw = process.env[CLAUDE_AUTH_MODE_ENV]?.trim();
		try {
			const authMode = parseClaudeAuthMode(raw);
			if (authMode === "api-key" && !process.env.ANTHROPIC_API_KEY?.trim()) {
				return `${CLAUDE_AUTH_MODE_ENV}=api-key requires ANTHROPIC_API_KEY`;
			}
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		if (!claudeBinOnPath()) {
			return "Claude Code binary not found (install Claude Code CLI or set CLAUDE_CODE_BIN for --host claude)";
		}
		return undefined;
	}
	if (host === "openai") {
		try {
			resolveOpenaiAuthMode();
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		if (
			!binOnPath(
				process.env.CODEX_BIN?.trim(),
				process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"],
			)
		) {
			return "OpenAI Codex binary not found (install Codex CLI or set CODEX_BIN for --host openai)";
		}
		return undefined;
	}
	try {
		resolveCursorAuthMode();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	const require = createRequire(import.meta.url);
	try {
		require.resolve("@cursor/sdk");
	} catch {
		return "@cursor/sdk not installed — required for Cursor runs (npm i -D @cursor/sdk)";
	}
	return undefined;
}
