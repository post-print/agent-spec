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
	health: typeof HEALTH_CHECK_PATH;
	messages: string[];
}

/** Local diagnostics for agent-test install and live-run readiness. */
export function runDoctor(options?: { cliPath?: string }): DoctorReport {
	const messages: string[] = [];
	const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
	const nodeOk = nodeMajor >= 22;
	if (!nodeOk) {
		messages.push(`Node ${process.versions.node} is below the required >=22`);
	}

	const cliPath = options?.cliPath ?? join(dirname(fileURLToPath(import.meta.url)), "cli.js");
	let cliPresent = false;
	try {
		accessSync(cliPath, constants.R_OK);
		cliPresent = true;
	} catch {
		messages.push(`CLI entry missing at ${cliPath} (run bun run build)`);
	}

	const cursorApiKeySet = Boolean(process.env.CURSOR_API_KEY?.trim());
	if (!cursorApiKeySet) {
		messages.push("CURSOR_API_KEY unset (required only for --live)");
	}

	try {
		const require = createRequire(import.meta.url);
		require.resolve("@post-print/agent-harness");
	} catch {
		messages.push("@post-print/agent-harness not resolvable");
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
		health: HEALTH_CHECK_PATH,
		messages,
	};
}
