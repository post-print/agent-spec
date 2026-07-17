#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type AgentHost,
	cleanupStaleScenarioWorktrees,
	isPathUnderRoot,
} from "@post-print/agent-harness";

import { isCliMain } from "./cli-entry.js";
import {
	compareSuiteReports,
	labelForCompareSide,
	loadSuiteRunReport,
	parseComparePairToken,
	writeCompareReport,
} from "./compare.js";
import { discoverSuites } from "./discover-suites.js";
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
import { registerLiveRunHandlers, runAllSuites, runSuite } from "./run-suite.js";
import {
	type FailOnMode,
	formatRunSummary,
	shouldFailScenario,
	summarizeReports,
} from "./suite-summary.js";
import { configureCliColor, theme } from "./theme.js";
import type { SuiteRunReport } from "./types.js";
import { formatSeedValidationReport, validateSeedPatches } from "./validate-seeds.js";
import { formatValidationReport, validateSuitePaths } from "./validate-suite.js";
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
	validateOnly: boolean;
	validateSeeds: boolean;
	validatePaths: boolean;
	failOn: FailOnMode;
	/** Live announce-stop retries (overrides AGENT_TEST_SCENARIO_RETRIES). */
	scenarioRetries?: number;
	/** Offline compare subcommand (`agent-test compare --a … --b …`). */
	compareMode: boolean;
	compareA?: string;
	compareB?: string;
	/** Live/replay A:B suite dirs or report JSON paths. */
	comparePairs?: string;
	compareOutDir?: string;
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
	let validateOnly = false;
	let validateSeeds = false;
	let validatePaths = false;
	let failOn: FailOnMode = "all";
	let scenarioRetries: number | undefined;
	let compareMode = false;
	let compareA: string | undefined;
	let compareB: string | undefined;
	let comparePairs: string | undefined;
	let compareOutDir: string | undefined;

	const startIndex = argv[2] === "compare" ? 3 : 2;
	if (argv[2] === "compare") {
		compareMode = true;
	}

	for (let i = startIndex; i < argv.length; i++) {
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
		} else if (token === "--validate-only") {
			validateOnly = true;
		} else if (token === "--validate-seeds") {
			validateSeeds = true;
		} else if (token === "--validate-paths") {
			validatePaths = true;
		} else if (token === "--fail-on" && argv[i + 1]) {
			const mode = argv[++i] as FailOnMode;
			if (mode !== "all" && mode !== "behavior" && mode !== "infra-only") {
				throw new Error("--fail-on must be all|behavior|infra-only");
			}
			failOn = mode;
		} else if (token === "--scenario-retries" && argv[i + 1]) {
			const parsed = Number(argv[++i]);
			if (!Number.isInteger(parsed) || parsed < 0) {
				throw new Error("--scenario-retries must be an integer >= 0");
			}
			scenarioRetries = parsed;
		} else if (token === "--compare-pairs" && argv[i + 1]) {
			comparePairs = argv[++i];
		} else if ((token === "--a" || token === "--compare-a") && argv[i + 1]) {
			compareA = argv[++i];
			compareMode = true;
		} else if ((token === "--b" || token === "--compare-b") && argv[i + 1]) {
			compareB = argv[++i];
			compareMode = true;
		} else if ((token === "--out-dir" || token === "--compare-out") && argv[i + 1]) {
			compareOutDir = argv[++i];
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

	if (compareMode && !comparePairs) {
		if (!compareA || !compareB) {
			throw new Error("compare requires --a <report.json> and --b <report.json>");
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
		validateOnly,
		validateSeeds,
		validatePaths,
		failOn,
		scenarioRetries,
		compareMode,
		compareA,
		compareB,
		comparePairs,
		compareOutDir: compareOutDir ? resolve(cwd, compareOutDir) : undefined,
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveSuiteScenariosPath(
	cwd: string,
	suitesDir: string,
	side: string,
): Promise<string> {
	const candidates = [
		resolve(cwd, side, "scenarios.json"),
		resolve(cwd, suitesDir, side, "scenarios.json"),
		resolve(side, "scenarios.json"),
	];
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`compare side "${side}" is not a suite report JSON or suite dir (looked under ${suitesDir}/ and cwd)`,
	);
}

async function loadOrRunCompareSide(
	args: ParsedCliArgs,
	side: string,
	stagingSessionId: string | undefined,
): Promise<SuiteRunReport> {
	const resolved = resolve(args.cwd, side);
	if (side.endsWith(".json") || resolved.endsWith(".json")) {
		const jsonPath = side.endsWith(".json") ? resolved : resolve(args.cwd, `${side}.json`);
		const path = (await pathExists(resolved)) ? resolved : jsonPath;
		if (!(await pathExists(path))) {
			throw new Error(`compare report not found: ${side}`);
		}
		return loadSuiteRunReport(path);
	}

	const suitePath = await resolveSuiteScenariosPath(args.cwd, args.suitesDir, side);
	return runSuite({
		cwd: args.cwd,
		suitePath,
		host: args.host,
		scenarioFilter: args.scenarioFilter,
		record: args.record,
		recordFixtures: args.recordFixtures,
		judge: args.judge,
		worktree: args.worktree,
		stagingSessionId,
		keepRecordings: args.keepRecordings,
		suitesDir: args.suitesDir,
		timeoutMs: args.timeoutMs,
		allowUserInput: args.allowUserInput,
		debug: args.debug,
		debugDir: args.debugDir,
		scenarioRetries: args.scenarioRetries,
	});
}

async function writeSuiteReportDump(
	outDir: string,
	label: string,
	report: SuiteRunReport,
): Promise<string> {
	await mkdir(outDir, { recursive: true });
	const path = join(outDir, `${label}.suite-report.json`);
	await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return path;
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

	if (args.compareMode && !args.comparePairs) {
		const aPath = resolve(args.cwd, args.compareA as string);
		const bPath = resolve(args.cwd, args.compareB as string);
		const aReport = await loadSuiteRunReport(aPath);
		const bReport = await loadSuiteRunReport(bPath);
		const outDir = args.compareOutDir ?? resolve(args.cwd, "compare-out");
		const compare = compareSuiteReports({
			aLabel: labelForCompareSide(aPath),
			bLabel: labelForCompareSide(bPath),
			a: aReport,
			b: bReport,
		});
		const written = await writeCompareReport({ outDir, report: compare });
		console.log(theme.tip(`compare JSON: ${written.jsonPath}`));
		console.log(theme.tip(`compare markdown: ${written.markdownPath}`));
		console.log(theme.fileTip("compare HTML", written.htmlPath));
		return compare.summary.passRegressions > 0 ? 1 : 0;
	}

	if (args.validateOnly || args.validateSeeds) {
		if (args.validateOnly) {
			const suitePaths = await discoverSuites(resolve(args.cwd, args.suitesDir));
			const filtered = args.filter
				? suitePaths.filter(
						(path) =>
							path.includes(`/${args.filter}/`) || path.endsWith(`/${args.filter}/scenarios.json`),
					)
				: suitePaths;
			const report = await validateSuitePaths(filtered, {
				validatePaths: args.validatePaths,
				repoRoot: args.cwd,
			});
			console.log(formatValidationReport(report));
			if (!report.ok) {
				return 1;
			}
		}
		if (args.validateSeeds) {
			const report = await validateSeedPatches({
				cwd: args.cwd,
				suitesDir: args.suitesDir,
				filter: args.filter,
			});
			console.log(formatSeedValidationReport(report));
			if (!report.ok) {
				return 1;
			}
		}
		return 0;
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
		if (args.live) {
			const host = args.host ?? "cursor";
			if (host === "claude" && !process.env.ANTHROPIC_API_KEY?.trim()) {
				console.error("ANTHROPIC_API_KEY required for --live --host claude (Claude Code CLI)");
				return 1;
			}
			if (host === "cursor" && !process.env.CURSOR_API_KEY?.trim()) {
				console.error("CURSOR_API_KEY required for --live (Cursor SDK runs)");
				return 1;
			}
			// Judge classifiers still use the Cursor SDK.
			if (args.judge !== false && !process.env.CURSOR_API_KEY?.trim()) {
				console.error(
					"CURSOR_API_KEY required for live judge classifiers (use --no-judge to skip)",
				);
				return 1;
			}
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
				console.log(`  ${theme.tip("Ctrl+C cancels in-flight scenarios")}`);
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

		let reports: SuiteRunReport[];
		let comparePassRegressions = 0;
		if (args.comparePairs) {
			const { a, b } = parseComparePairToken(args.comparePairs);
			const aReport = await loadOrRunCompareSide(args, a, stagingSessionId);
			const bReport = await loadOrRunCompareSide(args, b, stagingSessionId);
			reports = [aReport, bReport];
			if (!isChild) {
				const outDir =
					args.compareOutDir ??
					(stagingSessionRoot
						? join(stagingSessionRoot, "compare")
						: resolve(args.cwd, "compare-out"));
				await writeSuiteReportDump(outDir, labelForCompareSide(a), aReport);
				await writeSuiteReportDump(outDir, labelForCompareSide(b), bReport);
				const compare = compareSuiteReports({
					aLabel: labelForCompareSide(a),
					bLabel: labelForCompareSide(b),
					a: aReport,
					b: bReport,
				});
				comparePassRegressions = compare.summary.passRegressions;
				const written = await writeCompareReport({ outDir, report: compare });
				console.log(`\n${theme.tip(`compare JSON: ${written.jsonPath}`)}`);
				console.log(theme.tip(`compare markdown: ${written.markdownPath}`));
				console.log(theme.fileTip("compare HTML", written.htmlPath));
			}
		} else {
			reports = await runAllSuites({
				...args,
				stagingSessionId,
				timeoutMs: args.timeoutMs,
				allowUserInput: args.allowUserInput,
				debug: args.debug,
				debugDir: args.debugDir,
			});
		}

		let exitCode = 0;
		if (!isChild) {
			for (const report of reports) {
				const failed = report.results.filter((result) => !result.passed && !result.skipped);
				if (failed.length > 0) {
					const behaviorFailures = failed.filter((result) =>
						shouldFailScenario(result.failures, args.failOn),
					);
					if (behaviorFailures.length > 0) {
						exitCode = 1;
					}
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

			const runSummary = summarizeReports(reports);
			console.log(`\n${formatRunSummary(runSummary)}`);
			if (args.failOn === "behavior" && runSummary.infraFailures > 0 && exitCode === 0) {
				console.log(
					theme.tip(`${runSummary.infraFailures} infra failure(s) ignored (--fail-on=behavior)`),
				);
			}

			if (args.debug && stagingSessionRoot) {
				console.log(`\n${theme.tip(`debug session: ${stagingSessionRoot}`)}`);
			}

			if (args.htmlReport && reports.length > 0) {
				try {
					const pair = args.comparePairs ? parseComparePairToken(args.comparePairs) : undefined;
					const reportPath = await writeHtmlReport(reports, {
						host: args.host,
						suitesDir: args.suitesDir,
						includeCompare: Boolean(args.comparePairs),
						compareALabel: pair ? labelForCompareSide(pair.a) : undefined,
						compareBLabel: pair ? labelForCompareSide(pair.b) : undefined,
					});
					console.log(`\n${theme.fileTip("HTML report", reportPath)}`);
				} catch (error) {
					console.warn(
						theme.warn(
							`HTML report failed: ${error instanceof Error ? error.message : String(error)}`,
						),
					);
				}
			}

			if (comparePassRegressions > 0) {
				exitCode = 1;
			}
		} else {
			for (const report of reports) {
				const failed = report.results.filter((result) => !result.passed && !result.skipped);
				if (failed.some((result) => shouldFailScenario(result.failures, args.failOn))) {
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
