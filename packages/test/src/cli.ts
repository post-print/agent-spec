#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type AgentHost,
	cleanupStaleScenarioWorktrees,
	isPathUnderRoot,
} from "@post-print/agent-harness";

import { isCliMain } from "./cli-entry.js";
import { runDoctor } from "./doctor.js";
import { writeHtmlReport } from "./html-report.js";
import { assertLiveDogfoodPreflight } from "./preflight.js";
import { logProgress } from "./progress.js";
import {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingSessionRoot,
	setLiveStagingRootOverride,
} from "./record-trace.js";
import { registerLiveRunHandlers, runAllSuites } from "./run-suite.js";
import { configureCliColor, theme } from "./theme.js";
import { suppressNoisyRuntimeWarnings } from "./warnings.js";

suppressNoisyRuntimeWarnings();
configureCliColor();

export interface ParsedCliArgs {
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
	timeoutMs?: number;
	noTimeout: boolean;
	allowUserInput: boolean;
	doctor: boolean;
	htmlReport: boolean;
	debug: boolean;
	debugDir?: string;
}

/** Parse agent-test CLI argv (exported for unit tests). */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
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
	let timeoutMs: number | undefined;
	let noTimeout = false;
	let allowUserInput = false;
	let doctor = false;
	let htmlReport = true;
	let debug = process.env.AGENT_TEST_DEBUG === "1" || process.env.AGENT_TEST_DEBUG === "true";
	let debugDir: string | undefined;

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
		} else if (token === "--timeout-ms" && argv[i + 1]) {
			const parsed = Number(argv[++i]);
			if (Number.isFinite(parsed) && parsed > 0) {
				timeoutMs = parsed;
			}
		} else if (token === "--no-timeout") {
			noTimeout = true;
		} else if (token === "--allow-user-input") {
			allowUserInput = true;
		} else if (token === "--doctor") {
			doctor = true;
		} else if (token === "--no-html-report") {
			htmlReport = false;
		} else if (token === "--debug") {
			debug = true;
		} else if (token === "--debug-dir") {
			const value = argv[++i];
			if (!value || value.startsWith("-")) {
				throw new Error("--debug-dir requires a non-empty path argument");
			}
			debugDir = value;
			debug = true;
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

	if (debug) {
		keepRecordings = true;
		process.env.AGENT_TEST_DEBUG = "1";
		process.env.AGENT_TEST_VERBOSE = process.env.AGENT_TEST_VERBOSE ?? "1";
		process.env.AGENT_TEST_VERBOSE_PATHS = process.env.AGENT_TEST_VERBOSE_PATHS ?? "1";
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
		timeoutMs: noTimeout ? 0 : timeoutMs,
		noTimeout,
		allowUserInput,
		doctor,
		htmlReport,
		debug,
		debugDir: debugDir ? resolve(cwd, debugDir) : undefined,
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
	let args: ParsedCliArgs;
	try {
		args = parseCliArgs(process.argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		return 1;
	}

	if (args.doctor) {
		const report = runDoctor();
		for (const message of report.messages) {
			console.log(message);
		}
		return report.ok ? 0 : 1;
	}

	if (args.debugDir) {
		setLiveStagingRootOverride(args.debugDir);
	}

	const isChild = process.env.AGENT_TEST_CHILD === "1";
	if (args.debugDir && isPathUnderRoot(args.debugDir, args.cwd) && !isChild) {
		console.warn(
			theme.warn(
				`--debug-dir is inside the repo (${args.debugDir}). Default is $TMPDIR/agent-spec — prefer that for live runs so debug output stays out of git status.`,
			),
		);
	}

	const verbose =
		args.debug || process.env.AGENT_TEST_VERBOSE === "1" || process.env.AGENT_TEST_DEBUG === "1";
	const stagingSessionId =
		args.stagingSessionId?.trim() ||
		process.env.AGENT_TEST_STAGING_SESSION_ID?.trim() ||
		(args.live || args.debug || (args.record && !args.recordFixtures)
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

			registerLiveRunHandlers();
			if (!isChild) {
				const removed = await cleanupStaleScenarioWorktrees(args.cwd);
				if (removed.length > 0) {
					console.log(
						theme.warn(`Cleaned ${removed.length} stale agent-test worktree(s) from a prior crash`),
					);
				}
				console.log(theme.banner(args.debug ? "live debug" : "live"));
				if (stagingSessionRoot) {
					console.log(theme.bannerSession(stagingSessionRoot));
				}
				if (worktreeDisabled) {
					console.warn(
						theme.warn("running in repo cwd — agent file edits will persist in your working tree"),
					);
				}
				if (args.debug || process.env.AGENT_TEST_VERBOSE === "1") {
					if (!args.keepRecordings) {
						console.log(`  ${theme.tip("traces removed on exit unless --keep-recordings")}`);
					} else {
						console.log(`  ${theme.tip("debug: recordings kept")}`);
					}
					console.log(
						`  ${theme.tip("exit 137 = macOS OOM — isolated subprocesses (AGENT_TEST_NO_ISOLATE=1 to disable)")}`,
					);
				} else if (!args.keepRecordings) {
					console.log(`  ${theme.tip("traces removed on exit unless --keep-recordings")}`);
				}
			}
		} else if (args.debug && !isChild && stagingSessionRoot) {
			console.log(theme.banner("debug"));
			console.log(theme.bannerSession(stagingSessionRoot));
		}

		const reports = await runAllSuites({
			...args,
			stagingSessionId,
			timeoutMs: args.timeoutMs,
			allowUserInput: args.allowUserInput,
			debug: args.debug,
			debugDir: args.debugDir,
		});

		let exitCode = 0;
		if (!isChild) {
			for (const report of reports) {
				const failed = report.results.filter((result) => !result.passed && !result.skipped);
				if (failed.length > 0) {
					exitCode = 1;
					console.log(`\n${theme.failedScenariosHeader()}`);
					for (const result of failed) {
						console.log(theme.failedScenarioName(result.scenario));
						if (verbose) {
							for (const failure of result.failures) {
								console.log(
									theme.verboseFailure(
										failure.matcher,
										failure.message,
										failure.evidence,
										failure.category,
									),
								);
							}
						}
						if (args.debug && result.debugBundleDir) {
							console.log(`      ${theme.tip(result.debugBundleDir)}`);
						}
					}
				}
				console.log(theme.summary(report.suite, report.passed, report.failed, report.skipped));
			}

			if (args.debug && stagingSessionRoot) {
				console.log(`\n${theme.tip(`debug session: ${stagingSessionRoot}`)}`);
			}

			if (args.htmlReport && reports.length > 0) {
				try {
					const reportPath = await writeHtmlReport(reports, {
						host: args.host,
						suitesDir: args.suitesDir,
					});
					console.log(`\n${theme.tip(`HTML report: ${reportPath}`)}`);
				} catch (error) {
					console.warn(
						theme.warn(
							`HTML report failed: ${error instanceof Error ? error.message : String(error)}`,
						),
					);
				}
			}
		} else {
			for (const report of reports) {
				if (report.failed > 0) {
					exitCode = 1;
				}
			}
		}

		if (reports.length === 0) {
			logProgress(`No suites found under ${args.suitesDir}`);
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

if (isCliMain(process.argv[1], entry)) {
	void main()
		.then((code) => process.exit(code))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		});
}
