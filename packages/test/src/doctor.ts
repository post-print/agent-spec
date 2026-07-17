import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getHealthStatus, HEALTH_CHECK_PATH } from "@post-print/agent-harness";

export interface DoctorReport {
	ok: boolean;
	nodeMajor: number;
	nodeOk: boolean;
	cliPresent: boolean;
	cursorApiKeySet: boolean;
	cursorSdkPresent: boolean;
	anthropicApiKeySet: boolean;
	claudeBinPresent: boolean;
	health: typeof HEALTH_CHECK_PATH;
	messages: string[];
}

function claudeBinOnPath(): boolean {
	const override = process.env.CLAUDE_CODE_BIN?.trim();
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
	const names = process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude"] : ["claude"];
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
	let cliPresent = false;
	try {
		accessSync(cliPath, constants.R_OK);
		cliPresent = true;
		messages.push(`CLI entry: ${cliPath}`);
	} catch {
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
		messages.push("@cursor/sdk: installed (live Cursor runs ready)");
	} catch {
		messages.push("@cursor/sdk not installed — required for --live Cursor (npm i -D @cursor/sdk)");
	}

	const cursorApiKeySet = Boolean(process.env.CURSOR_API_KEY?.trim());
	if (cursorApiKeySet) {
		messages.push("CURSOR_API_KEY: set");
	} else {
		messages.push("CURSOR_API_KEY unset (required for --live Cursor / judge)");
	}

	const anthropicApiKeySet = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
	if (anthropicApiKeySet) {
		messages.push("ANTHROPIC_API_KEY: set");
	} else {
		messages.push("ANTHROPIC_API_KEY unset (required only for --live --host claude)");
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

	const health = getHealthStatus();
	const ok = nodeOk && cliPresent && health.ok;
	if (ok) {
		messages.push(`doctor ${HEALTH_CHECK_PATH}: ready`);
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
		health: HEALTH_CHECK_PATH,
		messages,
	};
}
