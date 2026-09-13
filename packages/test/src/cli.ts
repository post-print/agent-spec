#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type AgentHost,
	cleanupStaleScenarioWorktrees,
	isPathUnderRoot,
	knownAgentHosts,
	missingClassifierAuth,
} from "@post-print/agent-harness";

import { formatCheckReport, formatCheckSummary, missingHostsAuth, runCheck } from "./check.js";
import { isCliMain } from "./cli-entry.js";
import {
	compareSuiteReports,
	labelForCompareSide,
	loadSuiteRunReport,
	parseComparePairToken,
	writeCompareReport,
} from "./compare.js";
import { missingAgentAuth } from "./doctor.js";
import { installHostLogFilter } from "./host-log.js";
import { parseHostList, uniqueHosts } from "./hosts.js";
import { writeHtmlReport } from "./html-report.js";
import { loadHostAdapters } from "./load-adapters.js";
import { assertDirectAgentPreflight } from "./preflight.js";
import { logProgress } from "./progress.js";
import {
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingSessionRoot,
	setLiveStagingRootOverride,
} from "./record-trace.js";
import { shouldStartReportPreview, startDetachedReportPreview } from "./report-preview.js";
import {
	judgeAuthRequired,
	loadSelectedRubrics,
	registerLiveRunHandlers,
	runAllSuites,
	runSuite,
} from "./run-suite.js";
import {
	type FailOnMode,
	formatRunSummary,
	shouldFailScenario,
	summarizeReports,
} from "./suite-summary.js";
import { configureCliColor, theme } from "./theme.js";
import type { SuiteRunReport } from "./types.js";
import { suppressNoisyRuntimeWarnings } from "./warnings.js";

suppressNoisyRuntimeWarnings();
configureCliColor();

export interface ParsedCliArgs {
	cwd: string;
	suitesDir: string;
	/** Prefer `<rubricsDir>/<suite>/rubrics.json` (harness-only answer keys). */
	rubricsDir?: string;
	host?: AgentHost;
	/** Host matrix when `--host` lists more than one adapter. */
	hosts?: AgentHost[];
	/** True when `--host` included `all`. Re-expand after adapters load. */
	hostAll?: boolean;
	/** Consumer adapter modules (`--adapter`). */
	adapterModules?: string[];
	filter?: string;
	scenarioFilter?: string;
	stagingSessionId?: string;
	judge?: boolean;
	worktree?: boolean;
	keepRecordings: boolean;
	timeoutMs?: number;
	noTimeout: boolean;
	allowUserInput: boolean;
	/** Check the suite and host. Do not launch an agent. */
	check: boolean;
	help: boolean;
	doctor: boolean;
	htmlReport: boolean;
	/** Explicit HTML report path (ends in .html) or output directory for all report content. */
	reportOut?: string;
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
	/** Direct-run A:B suite dirs or report JSON paths. */
	comparePairs?: string;
	compareOutDir?: string;
}

function splitArgvFlag(token: string): { flag: string; inline?: string } | undefined {
	if (!token.startsWith("-") || token === "-") {
		return undefined;
	}
	if (token.startsWith("--")) {
		const eq = token.indexOf("=");
		if (eq === -1) {
			return { flag: token };
		}
		return { flag: token.slice(0, eq), inline: token.slice(eq + 1) };
	}
	return { flag: token };
}

function readFlagValue(
	flag: string,
	inline: string | undefined,
	argv: string[],
	index: number,
): { value: string; nextIndex: number } {
	if (inline !== undefined) {
		if (inline.length === 0) {
			throw new Error(`${flag} requires a value`);
		}
		return { value: inline, nextIndex: index };
	}
	const next = argv[index + 1];
	if (!next || next.startsWith("--") || /^-[A-Za-z]/.test(next)) {
		throw new Error(`${flag} requires a value`);
	}
	return { value: next, nextIndex: index + 1 };
}

function enableCheckMode(target: {
	check: boolean;
	validateOnly: boolean;
	validatePaths: boolean;
	validateSeeds: boolean;
}): void {
	target.check = true;
	target.validateOnly = true;
	target.validatePaths = true;
	target.validateSeeds = true;
}

/** Usage text for `--help`. */
export function formatHelp(): string {
	return [
		"agent-test [compare] [options] [suite]",
		"",
		"Launch a host agent and score the transcript.",
		"A run checks the suite and host first.",
		"",
		"  --check                         Check the suite and host. Do not launch an agent.",
		"  --help, -h                      Print this help.",
		"",
		"  --host cursor|claude|openai|all Host adapter (default: suite or cursor).",
		"                                  Repeat or comma-separate for a matrix.",
		"  --adapter <module>              Load a consumer host adapter module.",
		"  --suites-dir <path>             Suite root (default: agent-suites)",
		"  --suite <name>                  Run one suite",
		"  --scenario <name>               Run one scenario",
		"  --no-judge                      Skip the judge",
		"  --fail-on all|behavior|infra-only",
		"  --allow-user-input              Let a user agent answer AskQuestion tools",
		"  --timeout-ms <n>                Agent deadline",
		"  --no-timeout                    Disable the deadline",
		"  --scenario-retries <n>          Announce-stop retries",
		"  --debug                         Keep recordings and write a debug bundle",
		"  --debug-dir <path>              Debug session parent directory",
		"  --report-out <path>             HTML report file or directory",
		"  --no-html-report                Skip the HTML report",
		"  --no-worktree                   Run in the caller checkout (needs AGENT_TEST_ALLOW_IN_PLACE=1)",
		"",
		"  compare --a <report.json> --b <report.json> [--out-dir <dir>]",
		"  --compare-pairs <a>:<b>         Live A/B pair",
		"",
		"--doctor, --validate-only, --validate-paths, and --validate-seeds run --check.",
	].join("\n");
}

/** Parse agent-test CLI argv (exported for unit tests). */
export function parseCliArgs(argv: string[]): ParsedCliArgs {
	const cwd = process.cwd();
	let suitesDir = "agent-suites";
	let rubricsDir: string | undefined;
	const parsedHosts: AgentHost[] = [];
	let hostAll = false;
	const adapterModules: string[] = [];
	let filter: string | undefined;
	let scenarioFilter: string | undefined;
	let stagingSessionId: string | undefined;
	let judge: boolean | undefined;
	let worktree: boolean | undefined;
	let keepRecordings = false;
	let timeoutMs: number | undefined;
	let noTimeout = false;
	let allowUserInput = false;
	let check = false;
	let help = false;
	let doctor = false;
	let htmlReport = true;
	let reportOut: string | undefined;
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

	const checkMode = {
		check: false,
		validateOnly: false,
		validatePaths: false,
		validateSeeds: false,
	};

	for (let i = startIndex; i < argv.length; i++) {
		const token = argv[i];
		if (!token) {
			continue;
		}
		const parsed = splitArgvFlag(token);
		if (!parsed) {
			filter = token;
			continue;
		}
		const { flag, inline } = parsed;
		const read = (): string => {
			const result = readFlagValue(flag, inline, argv, i);
			i = result.nextIndex;
			return result.value;
		};

		switch (flag) {
			case "--help":
			case "-h":
				help = true;
				break;
			case "--check":
				enableCheckMode(checkMode);
				break;
			case "--doctor":
				doctor = true;
				enableCheckMode(checkMode);
				break;
			case "--validate-only":
				enableCheckMode(checkMode);
				break;
			case "--validate-seeds":
				enableCheckMode(checkMode);
				break;
			case "--validate-paths":
				enableCheckMode(checkMode);
				break;
			case "--host": {
				const value = read();
				if (
					value
						.split(",")
						.map((token) => token.trim().toLowerCase())
						.includes("all")
				) {
					hostAll = true;
				}
				parsedHosts.push(...parseHostList(value));
				break;
			}
			case "--adapter":
				adapterModules.push(resolve(cwd, read()));
				break;
			case "--suites-dir":
				suitesDir = read();
				break;
			case "--rubrics-dir":
				rubricsDir = read();
				break;
			case "--suite":
				filter = read();
				break;
			case "--scenario":
				scenarioFilter = read();
				break;
			case "--staging-session-id":
				stagingSessionId = read();
				break;
			case "--live":
				throw new Error("--live was removed because agent-test now always runs a real agent");
			case "--record":
				throw new Error(
					"--record was removed; direct runs capture transient traces automatically (use --keep-recordings to retain them)",
				);
			case "--record-fixtures":
				throw new Error(
					"--record-fixtures was removed because replay-based testing is deprecated and no longer supported",
				);
			case "--keep-recordings":
				keepRecordings = true;
				break;
			case "--judge":
				judge = true;
				break;
			case "--no-judge":
				judge = false;
				break;
			case "--no-worktree":
				worktree = false;
				break;
			case "--timeout-ms": {
				const parsedTimeout = Number(read());
				if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
					timeoutMs = parsedTimeout;
				}
				break;
			}
			case "--no-timeout":
				noTimeout = true;
				break;
			case "--allow-user-input":
				allowUserInput = true;
				break;
			case "--fail-on": {
				const mode = read() as FailOnMode;
				if (mode !== "all" && mode !== "behavior" && mode !== "infra-only") {
					throw new Error("--fail-on must be all|behavior|infra-only");
				}
				failOn = mode;
				break;
			}
			case "--scenario-retries": {
				const parsedRetries = Number(read());
				if (!Number.isInteger(parsedRetries) || parsedRetries < 0) {
					throw new Error("--scenario-retries must be an integer >= 0");
				}
				scenarioRetries = parsedRetries;
				break;
			}
			case "--compare-pairs":
				comparePairs = read();
				break;
			case "--a":
			case "--compare-a":
				compareA = read();
				compareMode = true;
				break;
			case "--b":
			case "--compare-b":
				compareB = read();
				compareMode = true;
				break;
			case "--out-dir":
			case "--compare-out":
				compareOutDir = read();
				break;
			case "--report-out":
				reportOut = read();
				break;
			case "--no-html-report":
				htmlReport = false;
				break;
			case "--debug":
				debug = true;
				break;
			case "--debug-dir": {
				const value = read();
				debugDir = value;
				debug = true;
				break;
			}
			default:
				throw new Error(`Unknown flag: ${flag}`);
		}
	}

	check = checkMode.check;
	validateOnly = checkMode.validateOnly;
	validatePaths = checkMode.validatePaths;
	validateSeeds = checkMode.validateSeeds;

	if (compareMode && !comparePairs) {
		if (!compareA || !compareB) {
			throw new Error("compare requires --a <report.json> and --b <report.json>");
		}
	}

	const hosts = uniqueHosts(parsedHosts);
	const host = hosts?.[0];

	judge = judge ?? true;
	worktree = worktree ?? true;

	if (debug) {
		keepRecordings = true;
		process.env.AGENT_TEST_DEBUG = "1";
		process.env.AGENT_TEST_VERBOSE = process.env.AGENT_TEST_VERBOSE ?? "1";
		process.env.AGENT_TEST_VERBOSE_PATHS = process.env.AGENT_TEST_VERBOSE_PATHS ?? "1";
	}

	return {
		cwd,
		suitesDir,
		rubricsDir,
		host,
		hosts,
		hostAll,
		adapterModules: adapterModules.length > 0 ? adapterModules : undefined,
		filter,
		scenarioFilter,
		stagingSessionId,
		judge,
		worktree,
		keepRecordings,
		timeoutMs: noTimeout ? 0 : timeoutMs,
		noTimeout,
		allowUserInput,
		check,
		help,
		doctor,
		htmlReport,
		reportOut: reportOut ? resolve(cwd, reportOut) : undefined,
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

/** Resolve an explicit report target into the HTML path and optional artifact directory. */
export function resolveReportOutput(reportOut?: string): { htmlPath?: string; outDir?: string } {
	if (!reportOut) {
		return {};
	}
	if (reportOut.toLowerCase().endsWith(".html")) {
		return { htmlPath: reportOut };
	}
	return { htmlPath: join(reportOut, "report.html"), outDir: reportOut };
}

async function htmlReportTip(label: string, reportPath: string): Promise<string> {
	if (shouldStartReportPreview()) {
		const url = await startDetachedReportPreview(reportPath);
		if (url) {
			return theme.fileTip(label, url);
		}
	}
	return theme.fileTip(label, reportPath);
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
		judge: args.judge,
		worktree: args.worktree,
		stagingSessionId,
		keepRecordings: args.keepRecordings,
		suitesDir: args.suitesDir,
		rubricsDir: args.rubricsDir,
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

async function cleanupRunArtifacts(
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
}

async function main(): Promise<number> {
	let args: ParsedCliArgs;
	try {
		args = parseCliArgs(process.argv);
		installHostLogFilter();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		return 1;
	}

	if (args.help) {
		console.log(formatHelp());
		return 0;
	}

	try {
		await loadHostAdapters({ cwd: args.cwd, adapterModules: args.adapterModules });
		if (args.hostAll) {
			args.hosts = uniqueHosts(knownAgentHosts());
			args.host = args.hosts?.[0];
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		return 1;
	}

	if (args.check || args.doctor || args.validateOnly || args.validateSeeds) {
		const report = await runCheck({
			cwd: args.cwd,
			suitesDir: args.suitesDir,
			filter: args.filter,
			rubricsDir: args.rubricsDir,
			host: args.host,
			hosts: args.hosts,
		});
		console.log(formatCheckReport(report));
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
		console.log(await htmlReportTip("compare HTML", written.htmlPath));
		return compare.summary.passRegressions > 0 ? 1 : 0;
	}

	if (args.debugDir) {
		setLiveStagingRootOverride(args.debugDir);
	}

	const isChild = process.env.AGENT_TEST_CHILD === "1";
	if (args.debugDir && isPathUnderRoot(args.debugDir, args.cwd) && !isChild) {
		console.warn(
			theme.warn(
				`--debug-dir is inside the repo (${args.debugDir}). Default is $TMPDIR/agent-spec — prefer that for direct runs so debug output stays out of git status.`,
			),
		);
	}

	const verbose =
		args.debug || process.env.AGENT_TEST_VERBOSE === "1" || process.env.AGENT_TEST_DEBUG === "1";
	const stagingSessionId =
		args.stagingSessionId?.trim() ||
		process.env.AGENT_TEST_STAGING_SESSION_ID?.trim() ||
		createLiveStagingSessionId();
	const stagingSessionRoot = stagingSessionId
		? getLiveStagingSessionRoot(stagingSessionId)
		: undefined;

	try {
		let checkHosts: AgentHost[] = args.hosts ?? (args.host ? [args.host] : ["cursor"]);
		if (!isChild) {
			const report = await runCheck({
				cwd: args.cwd,
				suitesDir: args.suitesDir,
				filter: args.filter,
				rubricsDir: args.rubricsDir,
				host: args.host,
				hosts: args.hosts,
			});
			console.log(theme.tip(formatCheckSummary(report)));
			if (!report.ok) {
				console.error(formatCheckReport(report));
				return 1;
			}
			checkHosts = report.hosts;
			const missingHost = missingHostsAuth(report.hosts);
			if (missingHost) {
				console.error(missingHost);
				return 1;
			}
		} else {
			const missingHost = missingAgentAuth(args.host ?? "cursor");
			if (missingHost) {
				console.error(missingHost);
				return 1;
			}
		}
		if (args.judge !== false) {
			let rubrics: Awaited<ReturnType<typeof loadSelectedRubrics>> = [];
			try {
				rubrics = await loadSelectedRubrics({
					cwd: args.cwd,
					suitesDir: args.suitesDir,
					filter: args.filter,
					scenarioFilter: args.scenarioFilter,
					rubricsDir: args.rubricsDir,
				});
			} catch {
				rubrics = [];
			}
			if (judgeAuthRequired(true, rubrics)) {
				for (const host of checkHosts) {
					const missingJudge = missingClassifierAuth(host);
					if (missingJudge) {
						console.error(`${missingJudge} (use --no-judge to skip)`);
						return 1;
					}
				}
			}
		}

		{
			try {
				await assertDirectAgentPreflight(args.cwd, args.suitesDir);
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
					"Direct agent tests require a sealed temp workspace. Set AGENT_TEST_ALLOW_IN_PLACE=1 to run in repo cwd (--no-worktree leaks agent edits into your working tree).",
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
				console.log(theme.banner(args.debug ? "direct debug" : "direct"));
				if (stagingSessionRoot) {
					console.log(theme.bannerSession(stagingSessionRoot));
				}
				const hints = ["Ctrl+C cancels"];
				if (args.debug || process.env.AGENT_TEST_VERBOSE === "1") {
					hints.push(args.keepRecordings ? "recordings kept" : "traces removed on exit");
					hints.push("exit 137 = macOS OOM");
				} else if (!args.keepRecordings) {
					hints.push("traces removed on exit");
				}
				console.log(theme.bannerHints(hints));
				if (worktreeDisabled) {
					console.warn(
						theme.warn("running in repo cwd — agent file edits will persist in your working tree"),
					);
				}
			}
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
				console.log(await htmlReportTip("compare HTML", written.htmlPath));
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
			const runSummaryText = formatRunSummary(runSummary);
			if (runSummaryText) {
				console.log(`\n${theme.runSummary(runSummaryText)}`);
			}
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
					console.log(`\n${await htmlReportTip("HTML report", reportPath)}`);
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
			await cleanupRunArtifacts(stagingSessionRoot, args.keepRecordings);
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
