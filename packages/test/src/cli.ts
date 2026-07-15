#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type AgentHost, cleanupStaleScenarioWorktrees } from "@agent-spec/harness";

import { assertLiveDogfoodPreflight } from "./preflight";
import {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingSessionRoot,
} from "./record-trace";
import { registerLiveRunHandlers, runAllSuites } from "./run-suite";

function parseArgs(argv: string[]): {
	cwd: string;
	suitesDir: string;
	host?: AgentHost;
	filter?: string;
	scenarioFilter?: string;
	stagingSessionId?: string;
	record: boolean;
	recordFixtures: boolean;
	live: boolean;
	judge?: boolean;
	worktree?: boolean;
	keepRecordings: boolean;
} {
	const cwd = process.cwd();
	let suitesDir = "agent-suites";
	let host: AgentHost | undefined;
	let filter: string | undefined;
	let scenarioFilter: string | undefined;
	let stagingSessionId: string | undefined;
	let record = false;
	let recordFixtures = false;
	let live = false;
	let judge: boolean | undefined;
	let worktree: boolean | undefined;
	let keepRecordings = false;

	for (let i = 2; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--host" && argv[i + 1]) {
			host = argv[++i] as AgentHost;
		} else if (token === "--suites-dir" && argv[i + 1]) {
			suitesDir = argv[++i] as string;
		} else if (token === "--suite" && argv[i + 1]) {
			filter = argv[++i];
		} else if (token === "--scenario" && argv[i + 1]) {
			scenarioFilter = argv[++i];
		} else if (token === "--staging-session-id" && argv[i + 1]) {
			stagingSessionId = argv[++i];
		} else if (token === "--record") {
			record = true;
		} else if (token === "--record-fixtures") {
			record = true;
			recordFixtures = true;
		} else if (token === "--live") {
			live = true;
		} else if (token === "--keep-recordings") {
			keepRecordings = true;
		} else if (token === "--judge") {
			judge = true;
		} else if (token === "--no-judge") {
			judge = false;
		} else if (token === "--no-worktree") {
			worktree = false;
		} else if (token && !token.startsWith("-")) {
			filter = token;
		}
	}

	if (live) {
		host = host ?? "cursor";
		record = true;
		judge = judge ?? true;
		worktree = worktree ?? true;
	}

	return {
		cwd,
		suitesDir,
		host,
		filter,
		scenarioFilter,
		stagingSessionId,
		record,
		recordFixtures,
		live,
		judge,
		worktree,
		keepRecordings,
	};
}

async function cleanupLiveRunArtifacts(
	cwd: string,
	stagingSessionRoot: string | undefined,
	keepRecordings: boolean,
): Promise<void> {
	if (keepRecordings) {
		return;
	}

	if (stagingSessionRoot) {
		try {
			await cleanupStagingSession(stagingSessionRoot);
		} catch {
			// best-effort
		}
	}

	const legacyRemoved = await cleanupLegacyRepoRecordings(cwd);
	if (legacyRemoved.length > 0) {
		console.log(`Removed legacy in-repo recording dir(s):\n  ${legacyRemoved.join("\n  ")}`);
	}
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv);
	const isChild = process.env.AGENT_TEST_CHILD === "1";
	const stagingSessionId =
		args.stagingSessionId?.trim() ||
		process.env.AGENT_TEST_STAGING_SESSION_ID?.trim() ||
		(args.live || (args.record && !args.recordFixtures) ? createLiveStagingSessionId() : undefined);
	const stagingSessionRoot = stagingSessionId
		? getLiveStagingSessionRoot(stagingSessionId)
		: undefined;

	try {
		if (args.live && !process.env.CURSOR_API_KEY) {
			console.error("CURSOR_API_KEY required for --live (Cursor SDK runs)");
			return 1;
		}

		if (args.live) {
			try {
				await assertLiveDogfoodPreflight(args.cwd, args.suitesDir);
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				return 1;
			}

			const inPlaceAllowed = process.env.AGENT_TEST_ALLOW_IN_PLACE === "1";
			const worktreeDisabled =
				args.worktree === false ||
				process.env.AGENT_TEST_NO_WORKTREE === "1" ||
				process.env.AGENT_TEST_NO_WORKTREE === "true";
			if (worktreeDisabled && !inPlaceAllowed) {
				console.error(
					"Live dogfood requires git worktree isolation. Set AGENT_TEST_ALLOW_IN_PLACE=1 to run in repo cwd (--no-worktree leaks agent edits into your working tree).",
				);
				return 1;
			}

			if (!isChild) {
				registerLiveRunHandlers();
				const removed = await cleanupStaleScenarioWorktrees(args.cwd);
				if (removed.length > 0) {
					console.log(`Cleaned ${removed.length} stale agent-test worktree(s) from a prior crash`);
				}
				console.log(
					"Live dogfood: cursor SDK → worktree → rubric → judge → $TMPDIR staging (use --record-fixtures to overwrite replay JSON)",
				);
				if (stagingSessionRoot) {
					console.log(`Live staging session: ${stagingSessionRoot}`);
					if (!args.keepRecordings) {
						console.log("Staging traces are removed on exit unless --keep-recordings");
					}
				}
				if (worktreeDisabled) {
					console.warn(
						"Warning: running in repo cwd — agent file edits will persist in your working tree",
					);
				} else {
					console.log(
						"Tip: exit 137 (Killed) is usually macOS OOM — live runs isolate each scenario in a subprocess by default; set AGENT_TEST_NO_ISOLATE=1 to disable",
					);
				}
			}
		}

		const reports = await runAllSuites({
			...args,
			stagingSessionId,
		});

		let exitCode = 0;
		for (const report of reports) {
			const failed = report.results.filter((result) => !result.passed && !result.skipped);
			if (failed.length > 0) {
				exitCode = 1;
				console.log(`\n${report.suite} — failure details`);
				for (const result of failed) {
					console.log(`  ✗ ${result.scenario}`);
					for (const failure of result.failures) {
						console.log(`      ${failure.matcher}: ${failure.message}`);
					}
				}
			}
			console.log(
				`${report.suite}: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`,
			);
		}

		if (reports.length === 0) {
			console.log(`No suites found under ${args.suitesDir}`);
			return 1;
		}

		return exitCode;
	} finally {
		if (stagingSessionId && !isChild) {
			await cleanupLiveRunArtifacts(args.cwd, stagingSessionRoot, args.keepRecordings);
		}
	}
}

const entry = fileURLToPath(import.meta.url);
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(entry);

if (isMain) {
	void main()
		.then((code) => process.exit(code))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		});
}
