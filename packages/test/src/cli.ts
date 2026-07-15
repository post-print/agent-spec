#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import {
	type AgentHost,
	cleanupStaleScenarioWorktrees,
} from "@post-print/agent-harness";

import { isCliMain } from "./cli-entry.js";
import { assertLiveDogfoodPreflight } from "./preflight.js";
import { logProgress } from "./progress.js";
import {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingSessionRoot,
} from "./record-trace.js";
import { registerLiveRunHandlers, runAllSuites } from "./run-suite.js";
import { theme } from "./theme.js";

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
		console.log(
			`Removed legacy in-repo recording dir(s):\n  ${legacyRemoved.join("\n  ")}`,
		);
	}
}

async function main(): Promise<number> {
	const args = parseArgs(process.argv);
	const isChild = process.env.AGENT_TEST_CHILD === "1";
	const verbose = process.env.AGENT_TEST_VERBOSE === "1";
	const stagingSessionId =
		args.stagingSessionId?.trim() ||
		process.env.AGENT_TEST_STAGING_SESSION_ID?.trim() ||
		(args.live || (args.record && !args.recordFixtures)
			? createLiveStagingSessionId()
			: undefined);
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
					console.log(
						theme.warn(
							`Cleaned ${removed.length} stale agent-test worktree(s) from a prior crash`,
						),
					);
				}
				console.log(theme.banner());
				console.log(
					theme.bannerDetail(
						"cursor SDK → worktree → rubric → judge → $TMPDIR staging",
					),
				);
				if (stagingSessionRoot) {
					console.log(theme.bannerSession(stagingSessionRoot));
					if (!args.keepRecordings) {
						console.log(
							`  ${theme.tip("traces removed on exit unless --keep-recordings")}`,
						);
					}
				}
				if (worktreeDisabled) {
					console.warn(
						theme.warn(
							"running in repo cwd — agent file edits will persist in your working tree",
						),
					);
				} else {
					console.log(
						`  ${theme.tip("tip: exit 137 = macOS OOM — scenarios run in isolated subprocesses (AGENT_TEST_NO_ISOLATE=1 to disable)")}`,
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
			const failed = report.results.filter(
				(result) => !result.passed && !result.skipped,
			);
			if (failed.length > 0) {
				exitCode = 1;
				console.log(`\n${theme.failedScenariosHeader()}`);
				for (const result of failed) {
					console.log(theme.failedScenarioName(result.scenario));
					if (verbose) {
						for (const failure of result.failures) {
							console.log(
								theme.verboseFailure(failure.matcher, failure.message),
							);
						}
					}
				}
			}
			console.log(
				theme.summary(
					report.suite,
					report.passed,
					report.failed,
					report.skipped,
				),
			);
		}

		if (reports.length === 0) {
			logProgress(`No suites found under ${args.suitesDir}`);
			return 1;
		}

		return exitCode;
	} finally {
		if (stagingSessionId && !isChild) {
			await cleanupLiveRunArtifacts(
				args.cwd,
				stagingSessionRoot,
				args.keepRecordings,
			);
		}
	}
}

const entry = fileURLToPath(import.meta.url);

if (isCliMain(process.argv[1], entry)) {
	void main()
		.then((code) => process.exit(code))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		});
}
