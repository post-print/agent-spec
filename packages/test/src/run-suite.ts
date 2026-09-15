import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

import type {
	AgentHost,
	AgentTrace,
	HostAuthMode,
	JudgeCriterion,
	LiveAgentEvent,
	McpServerConfig,
	RoutingContract,
	SkillContextSetting,
} from "@post-print/agent-harness";
import {
	buildHostPrompt,
	cancelActiveClaudeRun,
	cancelActiveCursorRun,
	cancelActiveOpenaiRun,
	captureWorkingTreeStatus,
	createSealedWorkspace,
	defaultSealedOverlayPaths,
	enrichTrace,
	filterWorkingTreeLeaks,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
	getProcessAuthMode,
	isBuiltinAgentHost,
	judgeCompareTraces,
	judgeTrace,
	loadContext,
	loadUnifiedDiffPaths,
	mergeMcpServers,
	parseScenarioWorkspace,
	partitionSeedCollateralLeaks,
	porcelainPathsFromLines,
	resolveAllowUserSkills,
	resolveHarnessArtifactIgnoreRoots,
	restoreWorkingTreePaths,
	runAgent,
	setProcessAuthMode,
	skillInvokeJudgeCriteria,
	skillPathsFromSetting,
	sumUsageParts,
	toolPathsOutsideWorkspace,
	traceEditsOutsideWorktree,
	traceHasUserInputTool,
} from "@post-print/agent-harness";

import {
	applyCompareArm,
	applySidecarCompareDurations,
	assertCompareGates,
	attachCompareStoryResults,
	buildCompareResult,
	compareArmDescription,
	compareArmLabel,
	compareArmTokens,
	compareArmTurns,
	compareResultArms,
	compareStoryFields,
	evaluateCompareGates,
	finalizeCompareGates,
	finalizeCompareOutcome,
	plainDescription,
	prefixCompareFailures,
	requireCompareArm,
	resolveCompareArms,
} from "./compare-scenario.js";
import { collectDebugEnvironment, getDebugBundleDir, writeDebugBundle } from "./debug-bundle.js";
import { discoverSuites } from "./discover-suites.js";
import { assertRubric } from "./expect.js";
import { assertionFailure } from "./failures.js";
import { resolveSuiteHosts, scenarioRunsOnHost, uniqueHosts } from "./hosts.js";
import {
	failuresForLiveSubprocessExit,
	killActiveLiveChildren,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
	spawnLiveScenario,
} from "./live-isolation.js";
import { resolveLiveTimeoutMs } from "./live-timeout.js";
import { loadSuiteFile } from "./load-suite.js";
import { bindMcpServersToCaller, mcpStdioScriptPaths } from "./mcp-config.js";
import {
	formatDuration,
	logLive,
	logPhase,
	logProgress,
	logVerdict,
	refreshHeartbeat,
	withHeartbeat,
} from "./progress.js";
import {
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRootOverride,
	getLiveStagingSessionRoot,
	getStagingAgentStartPath,
	getStagingResultPath,
	getStagingTracePath,
	type LiveCompareArmSidecar,
	type LiveScenarioResultSidecar,
	loadStagingResult,
	loadStagingTrace,
	recordTrace,
	resolveRecordingPath,
	setLiveStagingRootOverride,
	writeAgentStartMarker,
	writeStagingResult,
} from "./record-trace.js";
import { finalizeScenarioResult } from "./scenario-finalizer.js";
import { resolveScenarioRetryMaxAttempts, shouldRetryAnnounceStopFlake } from "./scenario-retry.js";
import {
	type CallerHeadSnapshot,
	captureCallerHead,
	restoreCallerHeadIfSeedCommit,
	seedScenarioWorktree,
} from "./scenario-seed.js";
import { buildScenarioStory, pathFromArgs, quoteExcerpt } from "./scenario-story.js";
import { totalTokensFromScenarioUsage } from "./scenario-usage.js";
import { summarizeReportResults } from "./suite-summary.js";
import { theme } from "./theme.js";
import type {
	AgentScenario,
	AgentSuiteDefaults,
	AssertionFailure,
	CompareArmId,
	JudgeRubricItem,
	JudgeVerdictResult,
	ScenarioCompareResult,
	ScenarioResult,
	ScenarioRubric,
	ScenarioStory,
	SuiteRunReport,
} from "./types.js";
import { validateSuiteFile } from "./validate-suite.js";
import type { ViewerCatalogScenario } from "./viewer/catalog.js";
import { viewerContextFiles } from "./viewer/context-files.js";
import { emitViewerEvent } from "./viewer/emit.js";
import type { ViewerEventEnvelope } from "./viewer/events.js";
import { DEFAULT_CLI_WORKERS, runWorkerPool } from "./worker-pool.js";

const require = createRequire(import.meta.url);
const packageVersion = (require("../package.json") as { version: string }).version;

let activeWorktreeCleanup: (() => Promise<void>) | undefined;
let activeCallerHeadRestore: { cwd: string; snapshot: CallerHeadSnapshot } | undefined;

interface CompareArmRun {
	id: CompareArmId;
	label: string;
	scenario: AgentScenario;
	result: ScenarioResult;
}
let liveSignalHandlersRegistered = false;

function setCallerHeadRestore(cwd: string, snapshot: CallerHeadSnapshot): void {
	activeCallerHeadRestore = { cwd, snapshot };
}

function clearCallerHeadRestore(): void {
	activeCallerHeadRestore = undefined;
}

async function restoreActiveCallerHead(): Promise<void> {
	if (!activeCallerHeadRestore) {
		return;
	}
	const { cwd, snapshot } = activeCallerHeadRestore;
	await restoreCallerHeadIfSeedCommit(cwd, snapshot);
	clearCallerHeadRestore();
}

function isChildProcess(): boolean {
	return process.env.AGENT_TEST_CHILD === "1";
}

function logScenarioDescription(description?: string): void {
	const text = plainDescription(description);
	if (!text) {
		return;
	}
	for (const line of theme.scenarioDescription(text)) {
		logProgress(line);
	}
}

function resolveMaxConversationTurns(): number | undefined {
	const raw = process.env.AGENT_TEST_MAX_TURNS?.trim();
	if (!raw) {
		return undefined;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Parent process prints suite headers and final verdicts; children only print phases. */
export function shouldPrintSuiteChrome(): boolean {
	return !isChildProcess();
}

/** Best-effort cancel + worktree cleanup when live runs are interrupted (Ctrl+C / SIGINT/SIGTERM). */
export function registerLiveRunHandlers(): void {
	if (liveSignalHandlersRegistered) {
		return;
	}
	liveSignalHandlersRegistered = true;

	const interrupt = (code: number) => {
		killActiveLiveChildren();
		cancelActiveCursorRun();
		cancelActiveClaudeRun();
		cancelActiveOpenaiRun();
		const cleanup = activeWorktreeCleanup;
		const headRestore = activeCallerHeadRestore;
		if (!cleanup && !headRestore) {
			process.exit(code);
			return;
		}
		void Promise.resolve()
			.then(async () => {
				if (cleanup) {
					await cleanup().catch(() => undefined);
				}
				if (headRestore) {
					await restoreCallerHeadIfSeedCommit(headRestore.cwd, headRestore.snapshot).catch(
						() => undefined,
					);
				}
			})
			.finally(() => process.exit(code));
	};

	process.on("SIGINT", () => interrupt(130));
	process.on("SIGTERM", () => interrupt(143));
}

function releaseLiveMemory(): void {
	const bunGc = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc;
	if (typeof bunGc === "function") {
		bunGc(true);
	}
}

export interface RunSuiteOptions {
	cwd: string;
	suitePath: string;
	host?: AgentHost;
	/**
	 * When true, skip scenarios pinned to a different host.
	 * Set by a multi-host matrix so `scenario.host` does not rerun on every cell.
	 */
	hostLocked?: boolean;
	/** Run only this scenario name (used by live subprocess isolation). */
	scenarioFilter?: string;
	/** Run the harness LLM judge for rubric.judge criteria. */
	judge?: boolean;
	/** Isolate each scenario in a detached git worktree. */
	worktree?: boolean;
	/** Session id for transient staging traces under $TMPDIR (see record-trace.ts). */
	stagingSessionId?: string;
	keepRecordings?: boolean;
	suitesDir?: string;
	suiteFilter?: string;
	/** Hard cap on live agent stream + wait (ms). */
	timeoutMs?: number;
	/** Allow AskQuestion-style tools in live runs (default false). */
	allowUserInput?: boolean;
	/** Evidence-rich failures + on-disk debug bundles. */
	debug?: boolean;
	/** Override staging sessions parent (from --debug-dir). */
	debugDir?: string;
	/** Live announce-stop retries (overrides AGENT_TEST_SCENARIO_RETRIES). */
	scenarioRetries?: number;
	/** Prefer `<rubricsDir>/<suite>/rubrics.json` over sibling rubrics (harness-only). */
	rubricsDir?: string;
	/** Consumer adapter modules to forward to isolated children. */
	adapterModules?: string[];
	/** Host billing mode. Default is subscription when omitted. */
	authMode?: HostAuthMode;
	/** Isolated child: run one compare arm only. */
	compareArm?: CompareArmId;
	/** Parallel isolated live children. Default 1. */
	workers?: number;
}

export interface RunAgentTestOptions {
	cwd: string;
	scenario: AgentScenario;
	suiteName?: string;
	defaults?: AgentSuiteDefaults;
	/** Overrides the suite default; a scenario host still wins. */
	host?: AgentHost;
	judge?: boolean;
	worktree?: boolean;
	timeoutMs?: number;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
	keepRecordings?: boolean;
	scenarioRetries?: number;
	/** Internal suite orchestration metadata; safe for programmatic callers to omit. */
	stagingSessionId?: string;
	suitesDir?: string;
	rubricsDir?: string;
	scenarioIndex?: number;
	scenarioTotal?: number;
	/** Host billing mode. Default is subscription when omitted. */
	authMode?: HostAuthMode;
	/** Isolated child: run one compare arm only. */
	compareArm?: CompareArmId;
}

/** Live-only mode hint from rubric — not part of the user scenario prompt. */
export function outputContractForRubric(rubric: ScenarioRubric): RoutingContract | undefined {
	if (rubric.routingBlock) {
		return "hands-off";
	}
	if (rubric.handsOnRouting) {
		return "hands-on";
	}
	return undefined;
}

function normalizeJudgeCriteria(judge: JudgeRubricItem[] | undefined): JudgeCriterion[] {
	if (!judge?.length) {
		return [];
	}
	return judge.map((item, index) => {
		if (typeof item === "string") {
			return { id: `judge-${index}`, question: item };
		}
		return { id: item.id ?? `judge-${index}`, question: item.question };
	});
}

/** Explicit judge questions plus skill-invoke questions for mustInvokeSkill. */
export function collectJudgeCriteria(rubric: ScenarioRubric): JudgeCriterion[] {
	return [
		...normalizeJudgeCriteria(rubric.judge),
		...skillInvokeJudgeCriteria(rubric.mustInvokeSkill ?? []),
	];
}

/** Shared judge questions only. Skill-follow checks stay per-arm and deterministic. */
export function collectCompareJudgeCriteria(rubric: ScenarioRubric): JudgeCriterion[] {
	return normalizeJudgeCriteria(rubric.judge);
}

/** Judge auth and the judge call apply only when a rubric has judge work. */
export function judgeAuthRequired(judge: boolean, rubrics: readonly ScenarioRubric[]): boolean {
	return judge !== false && rubrics.some((rubric) => collectJudgeCriteria(rubric).length > 0);
}

/** Shared judge on compare. Skill-follow judge questions stay on non-compare scenarios. */
export function scenarioNeedsJudge(
	judge: boolean,
	scenario: Pick<AgentScenario, "compare" | "rubric">,
): boolean {
	if (judge === false) {
		return false;
	}
	if (scenario.compare) {
		return (
			collectCompareJudgeCriteria(scenario.rubric).length > 0 ||
			(scenario.compare.judgeMetrics?.length ?? 0) > 0
		);
	}
	return collectJudgeCriteria(scenario.rubric).length > 0;
}

/** True when the selected live run will call the judge. */
export async function selectedRunNeedsJudge(options: {
	cwd: string;
	suitesDir: string;
	filter?: string;
	scenarioFilter?: string;
	rubricsDir?: string;
	judge?: boolean;
}): Promise<boolean> {
	if (options.judge === false) {
		return false;
	}
	const suitePaths = await discoverSuites(resolve(options.cwd, options.suitesDir));
	const filtered = options.filter
		? suitePaths.filter((suitePath) => {
				const suiteName = suiteNameFromPath(suitePath);
				return suiteName === options.filter || suitePath.includes(`/${options.filter}/`);
			})
		: suitePaths;
	for (const suitePath of filtered) {
		const suite = await loadSuiteFile(suitePath, { rubricsDir: options.rubricsDir });
		for (const scenario of suite.scenarios) {
			if (scenario.skip) {
				continue;
			}
			if (options.scenarioFilter && scenario.name !== options.scenarioFilter) {
				continue;
			}
			if (scenarioNeedsJudge(true, scenario)) {
				return true;
			}
		}
	}
	return false;
}

function questionForCriterion(criteria: JudgeCriterion[], id: string): string {
	return criteria.find((c) => c.id === id)?.question ?? id;
}

function toJudgeVerdictResults(
	trace: AgentTrace,
	criteria: JudgeCriterion[],
	verdictsFromJudge?: Array<{
		id: string;
		pass: boolean;
		rationale: string;
		evidence?: string[];
		prompt?: string;
		response?: string;
		infraError?: string;
		parseError?: string;
		rawSdkStatus?: string;
		sdkError?: { message?: string; code?: string };
		attempt?: number;
		durationMs?: number;
		transcriptChars?: number;
		promptChars?: number;
	}>,
): JudgeVerdictResult[] {
	const source = verdictsFromJudge ?? trace.judgeVerdicts ?? [];
	return source.map((verdict) => {
		const extended = verdict as {
			id: string;
			pass: boolean;
			rationale: string;
			evidence?: string[];
			prompt?: string;
			response?: string;
			infraError?: string;
			parseError?: string;
			rawSdkStatus?: string;
			sdkError?: { message?: string; code?: string };
			attempt?: number;
			durationMs?: number;
			transcriptChars?: number;
			promptChars?: number;
			usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
		};
		return {
			id: extended.id,
			question: questionForCriterion(criteria, extended.id),
			pass: extended.pass,
			rationale: extended.rationale,
			evidence: extended.evidence,
			prompt: extended.prompt,
			response: extended.response,
			infraError: extended.infraError,
			parseError: extended.parseError,
			rawSdkStatus: extended.rawSdkStatus,
			sdkError: extended.sdkError,
			attempt: extended.attempt,
			durationMs: extended.durationMs,
			transcriptChars: extended.transcriptChars,
			promptChars: extended.promptChars,
			usage: extended.usage,
		};
	});
}

function rubricFailuresOnly(failures: AssertionFailure[]): AssertionFailure[] {
	return failures.filter((f) => !f.matcher.startsWith("judge"));
}

function isDebugEnabled(options?: { debug?: boolean }): boolean {
	return (
		options?.debug === true ||
		process.env.AGENT_TEST_DEBUG === "1" ||
		process.env.AGENT_TEST_DEBUG === "true"
	);
}

function emitScenarioVerdict(options: {
	passed: boolean;
	index?: number;
	total?: number;
	name: string;
	durationMs: number;
	totalTokens?: number;
	judgeVerdicts?: JudgeVerdictResult[];
	failures: AssertionFailure[];
	story?: ScenarioStory;
	debug?: boolean;
	debugBundleDir?: string;
}): void {
	if (!shouldPrintSuiteChrome()) {
		return;
	}
	logVerdict(
		theme.scenarioVerdict({
			passed: options.passed,
			index: options.index,
			total: options.total,
			name: options.name,
			durationMs: options.durationMs,
			totalTokens: options.totalTokens,
			judgeVerdicts: options.judgeVerdicts,
			rubricFailures: rubricFailuresOnly(options.failures),
			failureCategory: options.failures[0]?.category,
			story: options.story,
			debug: options.debug,
			debugBundleDir: options.debugBundleDir,
		}),
	);
}

async function maybeWriteDebugBundle(options: {
	debug: boolean;
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
	stagingSessionId?: string;
	debugDir?: string;
	suiteName: string;
	scenario: AgentScenario;
	host: AgentHost;
	result: ScenarioResult;
	trace?: AgentTrace;
	timeoutMs?: number;
	worktree?: boolean;
	judge?: boolean;
	allowUserInput?: boolean;
	keepRecordings?: boolean;
	authMode?: HostAuthMode;
}): Promise<string | undefined> {
	if (!options.debug || options.result.skipped) {
		return undefined;
	}
	if (!options.stagingSessionId) {
		return undefined;
	}

	const dir = getDebugBundleDir(
		options.stagingSessionId,
		options.suiteName,
		options.scenario.name,
		getLiveStagingSessionRoot,
		options.host,
	);
	const cliPath =
		process.argv[1] ?? resolve(options.cwd, "node_modules/@post-print/agent-test/dist/cli.js");

	try {
		await writeDebugBundle({
			dir,
			result: options.result,
			trace: options.trace ?? options.result.trace,
			scenario: options.scenario,
			environment: collectDebugEnvironment({
				suite: options.suiteName,
				scenario: options.scenario.name,
				packageVersion,
				host: options.host,
				timeoutMs: options.timeoutMs,
				worktree: options.worktree,
				isolateLive: liveScenarioIsolationEnabled(),
			}),
			rerun: {
				cliPath,
				cwd: options.cwd,
				suitesDir: options.suitesDir,
				rubricsDir: options.rubricsDir,
				suite: options.suiteName,
				scenario: options.scenario.name,
				host: options.host,
				judge: options.judge,
				worktree: options.worktree,
				timeoutMs: options.timeoutMs,
				noTimeout: options.timeoutMs === 0,
				allowUserInput: options.allowUserInput,
				// Match child-spawn resolution (buildLiveScenarioCommand): fall back
				// to the process-global staging override so a parent rewrite of the
				// bundle never drops --debug-dir for library callers that set the
				// override without an explicit debugDir.
				debugDir: options.debugDir ?? getLiveStagingRootOverride(),
				keepRecordings: options.keepRecordings ?? true,
				authMode: options.authMode,
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`agent-test: debug bundle write failed (${dir}): ${message}`);
		return undefined;
	}

	if (shouldPrintSuiteChrome()) {
		logPhase(theme.debugBundlePointer(join(dir, "transcript.md")), { last: true });
	}
	return dir;
}

export async function runSuite(options: RunSuiteOptions): Promise<SuiteRunReport> {
	const previousStagingRoot = getLiveStagingRootOverride();
	if (options.debugDir !== undefined) {
		setLiveStagingRootOverride(options.debugDir);
	}
	const ownsStagingSession = options.stagingSessionId === undefined;
	const stagingSessionId = options.stagingSessionId ?? createLiveStagingSessionId();

	try {
		return await runSuiteBody({ ...options, stagingSessionId });
	} finally {
		if (ownsStagingSession && !options.keepRecordings && !options.debug) {
			await cleanupStagingSession(getLiveStagingSessionRoot(stagingSessionId)).catch(
				() => undefined,
			);
		}
		if (options.debugDir !== undefined) {
			setLiveStagingRootOverride(previousStagingRoot);
		}
	}
}

async function runSuiteBody(options: RunSuiteOptions): Promise<SuiteRunReport> {
	const suite = await loadSuiteFile(options.suitePath, { rubricsDir: options.rubricsDir });
	const validationIssues = validateSuiteFile(options.suitePath, suite);
	if (validationIssues.length > 0) {
		const details = validationIssues
			.map(
				(issue) =>
					`${issue.scenario ? `${issue.scenario} · ` : ""}${issue.field}: ${issue.message}`,
			)
			.join("\n");
		throw new Error(`Invalid suite file ${options.suitePath}:\n${details}`);
	}
	const defaultHost = options.host ?? suite.defaults?.host ?? "cursor";
	const results: ScenarioResult[] = [];
	const selected = options.scenarioFilter
		? suite.scenarios.filter((scenario) => scenario.name === options.scenarioFilter)
		: suite.scenarios;

	if (options.scenarioFilter && selected.length === 0) {
		throw new Error(`Scenario not found: ${options.scenarioFilter}`);
	}

	const hostLocked = options.hostLocked === true;
	const scenarios = hostLocked
		? selected.filter((scenario) => scenarioRunsOnHost(scenario, defaultHost, true))
		: selected;
	if (hostLocked && options.scenarioFilter && selected.length > 0 && scenarios.length === 0) {
		const pinned = selected[0]?.host;
		throw new Error(
			`Scenario ${options.scenarioFilter} is pinned to ${pinned} (this run is ${defaultHost})`,
		);
	}

	const filteredTotal = scenarios.length;
	const parentCounters = parentScenarioCounters();
	const displayTotal = parentCounters?.total ?? filteredTotal;
	const isolateLive =
		liveScenarioIsolationEnabled() && !options.scenarioFilter && filteredTotal > 1;
	const workers = Math.max(1, options.workers ?? DEFAULT_CLI_WORKERS);

	if (shouldPrintSuiteChrome()) {
		logProgress(`\n${theme.suiteHeader(suite.name, defaultHost, displayTotal)}`);
		if (isolateLive) {
			logProgress(`    ${theme.isolationNote()}`);
		}
	}

	if (isolateLive) {
		const isolateSlots: ScenarioResult[] = new Array(scenarios.length);
		await runWorkerPool(
			scenarios.map((scenario, index) => ({ scenario, index })),
			workers,
			async ({ scenario, index }) => {
				if (!scenario) {
					return;
				}
				const scenarioIndex = parentCounters?.index ?? index + 1;
				const scenarioTotal = displayTotal;
				if (scenario.skip) {
					const skipLabel = `[${scenarioIndex}/${scenarioTotal}] ${scenario.name}`;
					logProgress(theme.skipped(skipLabel));
					logScenarioDescription(scenario.description);
					isolateSlots[index] = {
						suite: suite.name,
						scenario: scenario.name,
						description: plainDescription(scenario.description),
						prompt: scenario.prompt,
						contextMode: scenario.contextMode ?? suite.defaults?.contextMode ?? "harness-preamble",
						passed: true,
						failures: [],
						skipped: true,
						durationMs: 0,
						story: buildScenarioStory({
							rubric: scenario.rubric,
							passed: true,
							skipped: true,
							failures: [],
						}),
					};
					return;
				}

				const started = performance.now();
				const debug = isDebugEnabled(options);
				const maxAttempts = !isChildProcess()
					? resolveScenarioRetryMaxAttempts(options.scenarioRetries)
					: 1;
				let attempts = 0;
				let failures: AssertionFailure[] = [];
				let scenarioTrace: AgentTrace | undefined;
				let previousAttemptExitCode: number | undefined;
				let childSidecar: LiveScenarioResultSidecar | undefined;

				while (true) {
					attempts++;
					const spawned = await spawnLiveScenario({
						cwd: options.cwd,
						suiteName: suite.name,
						scenarioName: scenario.name,
						suitesDir: options.suitesDir ?? "agent-suites",
						rubricsDir: options.rubricsDir,
						suiteFilter: options.suiteFilter ?? suite.name,
						stagingSessionId: options.stagingSessionId,
						keepRecordings: options.keepRecordings,
						worktree: options.worktree,
						judge: options.judge,
						host: defaultHost,
						adapterModules: options.adapterModules,
						scenarioIndex: index + 1,
						scenarioTotal: filteredTotal,
						timeoutMs: resolveLiveTimeoutMs(options.timeoutMs),
						noTimeout: options.timeoutMs === 0,
						allowUserInput: options.allowUserInput,
						debug: options.debug,
						debugDir: options.debugDir,
						previousExitCode: previousAttemptExitCode,
						authMode: options.authMode ?? getProcessAuthMode(),
					});
					previousAttemptExitCode = spawned.exitCode;
					failures = [];
					scenarioTrace = undefined;
					childSidecar =
						options.stagingSessionId !== undefined
							? await loadStagingResult(
									getStagingResultPath(options.stagingSessionId, suite.name, scenario.name),
								)
							: undefined;

					if (spawned.exitCode !== 0) {
						failures.push(
							...failuresForLiveSubprocessExit(spawned.exitCode, childSidecar, spawned.stderr),
						);
					}
					if (options.stagingSessionId) {
						if (scenario.compare) {
							const firstArm = resolveCompareArms(scenario.compare)[0];
							if (firstArm) {
								try {
									scenarioTrace = await loadStagingTrace(
										getStagingTracePath(
											options.stagingSessionId,
											suite.name,
											scenario.name,
											firstArm.id,
										),
									);
								} catch {
									// Trace may be missing when the child crashed before recording.
								}
							}
						} else {
							const tracePath = getStagingTracePath(
								options.stagingSessionId,
								suite.name,
								scenario.name,
							);
							try {
								scenarioTrace = await loadStagingTrace(tracePath);
							} catch {
								// Trace may be missing when the child crashed before recording.
							}
						}
					}

					const canRetry =
						failures.length > 0 &&
						attempts < maxAttempts &&
						shouldRetryAnnounceStopFlake(failures, scenarioTrace);
					if (canRetry) {
						logPhase(theme.phase("retry", `${attempts}/${maxAttempts - 1}`));
						continue;
					}
					break;
				}

				let judgeVerdicts: JudgeVerdictResult[] | undefined;
				let compareResult: ScenarioCompareResult | undefined;
				const judgeHost = options.host ?? scenario.host ?? suite.defaults?.host ?? "cursor";
				if (scenario.compare && options.stagingSessionId) {
					compareResult = applySidecarCompareDurations(
						await loadCompareResultFromStaging(options.stagingSessionId, suite.name, scenario),
						childSidecar,
					);
					scenarioTrace = compareResultArms(compareResult)[0]?.trace ?? scenarioTrace;
				}
				if (compareResult && options.judge !== false && scenario.compare?.judgeMetrics?.length) {
					for (const arm of compareResult.arms) {
						if (!arm.trace) continue;
						try {
							const judged = await runJudgeRubric(
								arm.trace,
								{ judge: scenario.compare.judgeMetrics },
								options.cwd,
								judgeHost,
							);
							arm.trace = judged.trace;
							arm.judgeVerdicts = toJudgeVerdictResults(
								judged.trace,
								scenario.compare.judgeMetrics,
								judged.verdicts,
							);
							arm.failures = [...(arm.failures ?? []), ...judged.failures];
							failures.push(
								...prefixCompareFailures(
									arm.label,
									judged.failures.filter((failure) => failure.category !== "rubric_miss"),
								),
							);
						} catch (error) {
							failures.push(
								assertionFailure(
									"judge",
									error instanceof Error ? error.message : "failed to judge compare arm",
									"judge_infra",
								),
							);
						}
					}
				}
				if (compareResult) {
					compareResult.gateResults = evaluateCompareGates(compareResult.gates, compareResult);
					if (failures.every((failure) => failure.category === "rubric_miss")) {
						failures.push(...assertCompareGates(compareResult.gates, compareResult));
					}
				}
				if (
					(options.judge !== false && failures.length === 0) ||
					(options.judge !== false &&
						scenario.compare &&
						failures.every((failure) => failure.category === "rubric_miss"))
				) {
					const compareTraces = compareResult ? compareResultArms(compareResult) : [];
					if (
						scenario.compare &&
						compareResult &&
						compareTraces.length > 0 &&
						compareTraces.every((arm) => arm.trace)
					) {
						const criteria = collectCompareJudgeCriteria(scenario.rubric);
						if (criteria.length > 0) {
							releaseLiveMemory();
							logPhase(theme.judgePhase(criteria.length), { last: true });
							try {
								const judged = await runCompareJudgeRubric(
									compareResult,
									scenario.rubric,
									options.cwd,
									judgeHost,
								);
								failures.push(...judged.failures);
								const firstTrace = compareTraces[0]?.trace;
								judgeVerdicts = toJudgeVerdictResults(
									{
										...(firstTrace ?? {
											messages: [],
											toolCalls: [],
											shellCommands: [],
											artifacts: {},
										}),
										judgeVerdicts: judged.verdicts,
									},
									criteria,
									judged.verdicts,
								);
							} catch (error) {
								failures.push(
									assertionFailure(
										"judge",
										error instanceof Error ? error.message : "failed to judge compare traces",
										"judge_infra",
									),
								);
							}
						}
					} else if (scenarioTrace && !scenario.compare) {
						const criteria = collectJudgeCriteria(scenario.rubric);
						if (criteria.length > 0) {
							releaseLiveMemory();
							logPhase(theme.judgePhase(criteria.length), { last: true });
							try {
								const judged = await runJudgeRubric(
									scenarioTrace,
									scenario.rubric,
									options.cwd,
									judgeHost,
								);
								failures.push(...judged.failures);
								scenarioTrace = judged.trace;
								judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria, judged.verdicts);
							} catch (error) {
								failures.push(
									assertionFailure(
										"judge",
										error instanceof Error
											? error.message
											: "failed to load staging trace for judge",
										"judge_infra",
									),
								);
							}
						}
					}
				}

				const durationMs = Math.round(performance.now() - started);
				const scenarioResult = finalizeScenarioResult({
					suite: suite.name,
					scenario,
					contextMode:
						childSidecar?.contextMode ??
						scenario.contextMode ??
						suite.defaults?.contextMode ??
						"harness-preamble",
					contextFiles: childSidecar?.contextFiles,
					hostInput: childSidecar?.hostInput,
					failures,
					durationMs,
					attempts,
					judgeVerdicts,
					trace: scenarioTrace,
					compare: compareResult,
					storyCompare: compareResult
						? attachCompareStoryResults(compareStoryFields(scenario), compareResult)
						: undefined,
					agentUsage: compareResult
						? sumUsageParts(compareResultArms(compareResult).map((arm) => arm.trace?.usage))
						: scenarioTrace?.usage,
				});
				const { passed, story } = scenarioResult;
				const debugBundleDir = await maybeWriteDebugBundle({
					debug,
					cwd: options.cwd,
					suitesDir: options.suitesDir ?? "agent-suites",
					rubricsDir: options.rubricsDir,
					stagingSessionId: options.stagingSessionId,
					debugDir: options.debugDir,
					suiteName: suite.name,
					scenario,
					host: defaultHost,
					result: scenarioResult,
					trace: scenarioTrace,
					timeoutMs: options.timeoutMs,
					worktree: options.worktree,
					judge: options.judge,
					allowUserInput: options.allowUserInput,
					keepRecordings: options.keepRecordings,
					authMode: options.authMode ?? getProcessAuthMode(),
				});
				scenarioResult.debugBundleDir = debugBundleDir;
				emitScenarioVerdict({
					passed,
					index: index + 1,
					total: filteredTotal,
					name: scenario.name,
					durationMs,
					totalTokens: totalTokensFromScenarioUsage(scenarioResult.usage, scenarioTrace?.usage),
					judgeVerdicts,
					failures,
					story,
					debug,
					debugBundleDir,
				});
				isolateSlots[index] = scenarioResult;
				releaseLiveMemory();
				return;
			},
		);
		for (const result of isolateSlots) {
			if (result) {
				results.push(result);
			}
		}
	} else {
		for (let index = 0; index < scenarios.length; index++) {
			const scenario = scenarios[index];
			if (!scenario) {
				continue;
			}

			const scenarioIndex = parentCounters?.index ?? index + 1;
			const scenarioTotal = displayTotal;
			results.push(
				await runAgentTest({
					cwd: options.cwd,
					suiteName: suite.name,
					scenario,
					defaults: suite.defaults,
					host: options.host,
					judge: options.judge,
					worktree: options.worktree,
					stagingSessionId: options.stagingSessionId,
					scenarioIndex,
					scenarioTotal,
					timeoutMs: options.timeoutMs,
					allowUserInput: options.allowUserInput,
					debug: options.debug,
					debugDir: options.debugDir,
					suitesDir: options.suitesDir,
					keepRecordings: options.keepRecordings,
					rubricsDir: options.rubricsDir,
					scenarioRetries: isChildProcess() ? 0 : options.scenarioRetries,
					compareArm: options.compareArm,
				}),
			);
			releaseLiveMemory();
		}
	}

	return {
		suite: suite.name,
		host: defaultHost,
		passed: results.filter((r) => r.passed).length,
		skipped: results.filter((r) => r.skipped).length,
		failed: results.filter((r) => !r.passed && !r.skipped).length,
		results,
		summary: summarizeReportResults(results),
	};
}

/** Suite trees and MCP scripts from the caller, so uncommitted fixtures reach the host. */
function liveOverlayExtras(
	cwd: string,
	suitesDir: string,
	contextSources?: string[],
	mcpServers?: Record<string, McpServerConfig>,
): string[] {
	const extras = [...(contextSources ?? [])];
	const suitesRel = overlayRelPath(cwd, suitesDir);
	if (suitesRel && !extras.includes(suitesRel)) {
		extras.push(suitesRel);
	}
	for (const script of mcpStdioScriptPaths(mcpServers)) {
		if (!extras.includes(script)) {
			extras.push(script);
		}
	}
	return extras;
}

function overlayRelPath(cwd: string, path: string): string | undefined {
	const trimmed = path.replace(/^\.\//, "").trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (!trimmed.startsWith("/")) {
		return trimmed;
	}
	const root = resolve(cwd);
	if (trimmed === root) {
		return undefined;
	}
	if (trimmed.startsWith(`${root}/`)) {
		return trimmed.slice(root.length + 1);
	}
	return undefined;
}

function resolveRunWorkspace(
	defaultWorkspace?: string,
	scenarioWorkspace?: string,
): string | undefined {
	const raw = scenarioWorkspace !== undefined ? scenarioWorkspace : defaultWorkspace;
	const parsed = parseScenarioWorkspace(raw);
	if (!parsed.ok) {
		throw new Error(parsed.message);
	}
	return parsed.rel;
}

function mergeContextSources(
	defaults?: string[],
	scenarioSources?: string[],
): string[] | undefined {
	const merged = [...(defaults ?? []), ...(scenarioSources ?? [])].filter(
		(value) => typeof value === "string" && value.trim().length > 0,
	);
	return merged.length > 0 ? merged : undefined;
}

function defaultProfileForHost(host: AgentHost): "cursor" | "claude" | "shared" {
	if (host === "cursor") {
		return "cursor";
	}
	if (host === "claude") {
		return "claude";
	}
	return "shared";
}

/** Run one real agent scenario. JSON suites delegate to this same execution boundary. */
export async function runAgentTest(options: RunAgentTestOptions): Promise<ScenarioResult> {
	const previousStagingRoot = getLiveStagingRootOverride();
	if (options.debugDir !== undefined) {
		setLiveStagingRootOverride(options.debugDir);
	}
	const stagingSessionId =
		options.stagingSessionId ??
		(options.debug || options.keepRecordings ? createLiveStagingSessionId() : undefined);
	const previousAuthMode = getProcessAuthMode();
	if (options.authMode !== undefined) {
		setProcessAuthMode(options.authMode);
	}
	try {
		return await runAgentTestBody({ ...options, stagingSessionId });
	} finally {
		if (options.authMode !== undefined) {
			setProcessAuthMode(previousAuthMode);
		}
		if (options.debugDir !== undefined) {
			setLiveStagingRootOverride(previousStagingRoot);
		}
	}
}

async function runAgentTestBody(options: RunAgentTestOptions): Promise<ScenarioResult> {
	const legacyScenario = options.scenario as unknown as {
		host?: unknown;
		replayTrace?: unknown;
	};
	const legacyDefaults = options.defaults as unknown as { host?: unknown } | undefined;
	if (
		legacyScenario.host === "replay" ||
		legacyDefaults?.host === "replay" ||
		"replayTrace" in legacyScenario
	) {
		throw new Error(
			"Replay-based testing is deprecated and no longer supported; use Cursor, Claude, or OpenAI.",
		);
	}
	const suiteName = options.suiteName ?? "direct";
	const defaultHost = options.host ?? options.defaults?.host ?? "cursor";
	const maxAttempts = resolveScenarioRetryMaxAttempts(options.scenarioRetries);
	let attempts = 0;
	let result!: ScenarioResult;

	while (true) {
		attempts++;
		result = await runAgentTestOnce(
			options.cwd,
			suiteName,
			options.scenario,
			defaultHost,
			options.defaults?.contextMode,
			options.defaults?.profile,
			options.defaults?.skills,
			options.defaults?.contextSources,
			options.defaults?.mcpServers,
			options.defaults?.workspace,
			options.defaults?.allowUserSkills,
			options.judge ?? true,
			options.worktree ?? true,
			options.stagingSessionId,
			options.scenarioIndex,
			options.scenarioTotal,
			options.timeoutMs,
			options.allowUserInput,
			options.debug,
			options.debugDir,
			options.suitesDir ?? "agent-suites",
			options.keepRecordings,
			options.rubricsDir,
			{ suppressEmit: maxAttempts > 1, compareArm: options.compareArm },
		);
		const canRetry =
			!result.skipped &&
			!result.passed &&
			attempts < maxAttempts &&
			shouldRetryAnnounceStopFlake(result.failures, result.trace);
		if (!canRetry) {
			break;
		}
		logPhase(theme.phase("retry", `${attempts}/${maxAttempts - 1}`));
	}

	result.attempts = attempts;
	if (maxAttempts > 1) {
		const debug = isDebugEnabled(options);
		const debugBundleDir = await maybeWriteDebugBundle({
			debug,
			cwd: options.cwd,
			suitesDir: options.suitesDir ?? "agent-suites",
			rubricsDir: options.rubricsDir,
			stagingSessionId: options.stagingSessionId,
			debugDir: options.debugDir,
			suiteName,
			scenario: options.scenario,
			host: options.scenario.host ?? defaultHost,
			result,
			trace: result.trace,
			timeoutMs: options.timeoutMs,
			worktree: options.worktree,
			judge: options.judge ?? true,
			allowUserInput: options.allowUserInput,
			keepRecordings: options.keepRecordings,
			authMode: options.authMode ?? getProcessAuthMode(),
		});
		result.debugBundleDir = debugBundleDir;
		emitScenarioVerdict({
			passed: result.passed,
			index: options.scenarioIndex,
			total: options.scenarioTotal,
			name: options.scenario.name,
			durationMs: result.durationMs,
			totalTokens: totalTokensFromScenarioUsage(result.usage, result.trace?.usage),
			judgeVerdicts: result.judgeVerdicts,
			failures: result.failures,
			story: result.story,
			debug,
			debugBundleDir,
		});
	}
	return result;
}

async function runAgentTestOnce(
	cwd: string,
	suiteName: string,
	scenario: AgentScenario,
	defaultHost: AgentHost,
	defaultContextMode?: AgentScenario["contextMode"],
	defaultProfile?: AgentScenario["profile"],
	defaultSkills?: SkillContextSetting,
	defaultContextSources?: string[],
	defaultMcpServers?: Record<string, McpServerConfig>,
	defaultWorkspace?: string,
	defaultAllowUserSkills?: boolean,
	judge?: boolean,
	worktree?: boolean,
	stagingSessionId?: string,
	scenarioIndex?: number,
	scenarioTotal?: number,
	timeoutMs?: number,
	allowUserInput?: boolean,
	debugFlag?: boolean,
	debugDir?: string,
	suitesDir = "agent-suites",
	keepRecordings?: boolean,
	rubricsDir?: string,
	runOptions?: { suppressEmit?: boolean; compareArm?: CompareArmId; writeSidecar?: boolean },
): Promise<ScenarioResult> {
	const started = performance.now();
	const debug = isDebugEnabled({ debug: debugFlag });
	const suppressEmit = runOptions?.suppressEmit === true;
	const requestedContextMode = scenario.contextMode ?? defaultContextMode ?? "harness-preamble";

	if (scenario.skip) {
		const skipLabel =
			scenarioIndex !== undefined && scenarioTotal !== undefined
				? `[${scenarioIndex}/${scenarioTotal}] ${scenario.name}`
				: scenario.name;
		logProgress(theme.skipped(skipLabel));
		logScenarioDescription(scenario.description);
		return {
			suite: suiteName,
			scenario: scenario.name,
			description: plainDescription(scenario.description),
			prompt: scenario.prompt,
			contextMode: requestedContextMode,
			passed: true,
			failures: [],
			skipped: true,
			durationMs: 0,
			story: buildScenarioStory({
				rubric: scenario.rubric,
				passed: true,
				skipped: true,
				failures: [],
			}),
		};
	}

	if (scenario.compare && runOptions?.compareArm === undefined) {
		return runCompareAgentTestOnce(
			cwd,
			suiteName,
			scenario,
			defaultHost,
			defaultContextMode,
			defaultProfile,
			defaultSkills,
			defaultContextSources,
			defaultMcpServers,
			defaultWorkspace,
			defaultAllowUserSkills,
			judge,
			worktree,
			stagingSessionId,
			scenarioIndex,
			scenarioTotal,
			timeoutMs,
			allowUserInput,
			debugFlag,
			debugDir,
			suitesDir,
			keepRecordings,
			rubricsDir,
			{ suppressEmit },
		);
	}

	if (runOptions?.compareArm && scenario.compare) {
		scenario = requireCompareArm(scenario, runOptions.compareArm);
	}

	const host = scenario.host ?? defaultHost;
	const contextMode = scenario.contextMode ?? defaultContextMode ?? "harness-preamble";
	const profile = scenario.profile ?? defaultProfile ?? defaultProfileForHost(host);
	const skills = scenario.skills ?? defaultSkills;
	const contextSources = mergeContextSources(defaultContextSources, scenario.contextSources);
	const workspaceRel = resolveRunWorkspace(defaultWorkspace, scenario.workspace);
	const fixtureWorkspace = workspaceRel !== undefined;
	const allowUserSkills = resolveAllowUserSkills(scenario.allowUserSkills, defaultAllowUserSkills);
	const mcpServers = fixtureWorkspace
		? bindMcpServersToCaller(mergeMcpServers(defaultMcpServers, scenario.mcpServers), cwd)
		: mergeMcpServers(defaultMcpServers, scenario.mcpServers);
	const liveTimeoutMs = resolveLiveTimeoutMs(timeoutMs);
	const failOnUserInput = !allowUserInput;
	const viewerEnvelope: ViewerEventEnvelope = {
		suite: suiteName,
		scenario: scenario.name,
		host,
		...(runOptions?.compareArm ? { arm: runOptions.compareArm } : {}),
	};

	if (runOptions?.compareArm) {
		logPhase(theme.phase("arm", `${runOptions.compareArm.toUpperCase()} ${host}`));
	} else if (scenarioIndex !== undefined && scenarioTotal !== undefined) {
		logProgress(theme.scenarioTitle(scenarioIndex, scenarioTotal, scenario.name, host));
		logScenarioDescription(scenario.description);
	} else {
		logProgress(theme.scenarioLabel(scenario.name, host));
		logScenarioDescription(scenario.description);
	}

	const useWorktree = worktree !== false && !process.env.AGENT_TEST_NO_WORKTREE;
	let worktreeHandle: Awaited<ReturnType<typeof createSealedWorkspace>> | undefined;
	let callerHeadBefore: Awaited<ReturnType<typeof captureCallerHead>> | undefined;
	const callerTreeBefore = useWorktree ? await captureWorkingTreeStatus(cwd) : undefined;
	if (useWorktree) {
		emitViewerEvent({ type: "status", text: "Creating sealed workspace.", ...viewerEnvelope });
		if (scenario.seedPatch) {
			callerHeadBefore = await captureCallerHead(cwd);
			setCallerHeadRestore(cwd, callerHeadBefore);
		}
		worktreeHandle = await createSealedWorkspace({
			callerCwd: cwd,
			workspace: workspaceRel,
			overlayPaths: fixtureWorkspace
				? undefined
				: defaultSealedOverlayPaths(
						liveOverlayExtras(cwd, suitesDir, contextSources, mcpServers),
						skillPathsFromSetting(skills),
					),
		});
		activeWorktreeCleanup = worktreeHandle.cleanup;
		if (scenario.seedPatch) {
			logPhase(theme.phase("seed", theme.basename(scenario.seedPatch)));
			emitViewerEvent({
				type: "status",
				text: `Applying seed ${basename(scenario.seedPatch)}.`,
				...viewerEnvelope,
			});
			await seedScenarioWorktree(cwd, worktreeHandle.path, scenario.seedPatch, {
				stageOnly: scenario.seedStageOnly === true,
			});
			emitViewerEvent({ type: "status", text: "Seed applied.", ...viewerEnvelope });
		}
	} else {
		logPhase(theme.phase("worktree", theme.phaseDim("disabled (AGENT_TEST_ALLOW_IN_PLACE=1)")));
	}
	const runCwd = worktreeHandle?.path ?? (workspaceRel ? resolve(cwd, workspaceRel) : cwd);

	try {
		const context = await loadContext({
			cwd: runCwd,
			mode: contextMode,
			profile,
			skills,
			contextSources,
		});
		const outputContract =
			contextMode === "host-native" ? undefined : outputContractForRubric(scenario.rubric);
		const hostInput = isBuiltinAgentHost(host)
			? buildHostPrompt({ context, outputContract, prompt: scenario.prompt })
			: undefined;
		const agentStartMarkerPath =
			isChildProcess() && stagingSessionId
				? getStagingAgentStartPath(
						stagingSessionId,
						suiteName,
						scenario.name,
						runOptions?.compareArm,
					)
				: undefined;
		emitViewerEvent({ type: "cell_started", ...viewerEnvelope });
		emitViewerEvent({ type: "status", text: "Starting host agent.", ...viewerEnvelope });
		const contextFiles = viewerContextFiles(
			context.preamble,
			context.sources,
			contextSources ?? [],
		);
		if (contextFiles.length > 0) {
			emitViewerEvent({
				type: "status",
				text: contextFiles.map((file) => file.why).join(" "),
				...viewerEnvelope,
			});
		}
		emitViewerEvent({
			type: "context",
			mode: contextMode,
			files: contextFiles,
			hostInput,
			...viewerEnvelope,
		});
		emitViewerEvent({ type: "prompt", text: scenario.prompt, ...viewerEnvelope });
		logPhase(theme.phase("agent", theme.phaseDim("started")));
		const agentStarted = performance.now();
		let livePreview: string | undefined;
		const session = await withHeartbeat(
			runAgent({
				host,
				cwd: runCwd,
				context,
				profile,
				prompt: scenario.prompt,
				outputContract,
				mcpServers,
				allowUserSkills,
				networkAccess: scenario.networkAccess === true,
				authMode: getProcessAuthMode(),
				timeoutMs: liveTimeoutMs,
				failOnUserInput,
				maxConversationTurns: resolveMaxConversationTurns(),
				onDeadlineStart: agentStartMarkerPath
					? () => writeAgentStartMarker(agentStartMarkerPath)
					: undefined,
				onAgentEvent: (event: LiveAgentEvent) => {
					if (event.type === "tool") {
						emitViewerEvent({
							type: "tool",
							name: event.name,
							args: event.args,
							...viewerEnvelope,
						});
						logLive(theme.liveTool(event.name, pathFromArgs(event.args)));
						livePreview = undefined;
						refreshHeartbeat();
						return;
					}
					emitViewerEvent({ type: "text", text: event.text, ...viewerEnvelope });
					// Clock tick paints the preview. Do not rewrite here — a long
					// line wraps and `\r` cannot clear the leftover row.
					livePreview = quoteExcerpt(event.text);
				},
			}),
			{ started: agentStarted, preview: () => livePreview },
		);

		logPhase(
			theme.phase(
				"agent",
				`${theme.statusCompleted(session.status)} ${theme.duration(formatDuration(performance.now() - agentStarted))}`,
			),
		);

		let trace = enrichTrace(session.trace);
		const failures: AssertionFailure[] = [];

		if (session.status !== "completed") {
			const runtimeEvidence = [
				`durationMs=${session.durationMs}`,
				`messages=${trace.messages.length}`,
				`toolCalls=${trace.toolCalls.length}`,
				`skillsInvoked=${trace.skillsInvoked?.length ? trace.skillsInvoked.join(",") : "(none)"}`,
				trace.artifacts?.cursorRawStatus
					? `cursorRawStatus=${trace.artifacts.cursorRawStatus}`
					: undefined,
				trace.artifacts?.cursorSdkErrorCode
					? `cursorSdkErrorCode=${trace.artifacts.cursorSdkErrorCode}`
					: undefined,
				trace.artifacts?.cursorSdkErrorMessage
					? `cursorSdkErrorMessage=${trace.artifacts.cursorSdkErrorMessage}`
					: undefined,
			]
				.filter(Boolean)
				.join("\n");
			failures.push(
				assertionFailure(
					"runAgent",
					session.error ?? `agent session ${session.status}`,
					"agent_runtime",
					runtimeEvidence,
				),
			);
		} else if (failOnUserInput && traceHasUserInputTool(trace.toolCalls)) {
			failures.push(
				assertionFailure(
					"runAgent",
					"agent trace contains AskQuestion-style user-input tool in headless mode",
					"agent_runtime",
					`toolCalls=${trace.toolCalls.map((call) => call.name).join(", ")}`,
				),
			);
		}

		failures.push(
			...assertRubric(trace, scenario.rubric, {
				skillsMode: context.skillsMode,
			}),
		);

		if (worktreeHandle) {
			const escaped = toolPathsOutsideWorkspace(trace, worktreeHandle.path);
			if (escaped.length > 0) {
				failures.push(
					assertionFailure(
						"workingTreeLeak",
						`agent used paths outside the sealed workspace: ${escaped.join(", ")}`,
						"worktree_leak",
						`escaped=${escaped.join(", ")}`,
					),
				);
			}
		}

		if (useWorktree && callerTreeBefore !== undefined) {
			const callerTreeAfter = await captureWorkingTreeStatus(cwd);
			const ignoreRoots = resolveHarnessArtifactIgnoreRoots(cwd, getLiveStagingRootOverride());
			const leaked = filterWorkingTreeLeaks(
				findWorkingTreeLeak(callerTreeBefore, callerTreeAfter),
				ignoreRoots,
				cwd,
			);
			const seedPaths = scenario.seedPatch
				? await loadUnifiedDiffPaths(resolve(cwd, scenario.seedPatch)).catch(() => [])
				: [];
			const outsideEdits =
				worktreeHandle !== undefined
					? traceEditsOutsideWorktree(trace, worktreeHandle.path, cwd)
					: [];
			const { collateral, agentLeaks } = partitionSeedCollateralLeaks(
				leaked,
				seedPaths,
				outsideEdits,
			);
			if (collateral.length > 0) {
				await restoreWorkingTreePaths(cwd, porcelainPathsFromLines(collateral)).catch(
					() => undefined,
				);
			}
			if (outsideEdits.length > 0) {
				failures.push(
					assertionFailure(
						"workingTreeLeak",
						`agent edited caller checkout outside worktree: ${outsideEdits.join(", ")}`,
						"worktree_leak",
						[
							`outsideEdits=${outsideEdits.join(", ")}`,
							`seedPaths=${seedPaths.join(", ") || "(none)"}`,
							`collateralRestored=${collateral.length}`,
						].join("\n"),
					),
				);
			}
			if (agentLeaks.length > 0) {
				failures.push(
					assertionFailure(
						"workingTreeLeak",
						`live agent mutated caller working tree (use worktree isolation):\n${formatWorkingTreeLeak(agentLeaks)}`,
						"worktree_leak",
						[
							`agentLeaks=${agentLeaks.length}`,
							`seedPaths=${seedPaths.join(", ") || "(none)"}`,
							`collateralRestored=${collateral.length}`,
							`outsideEdits=${outsideEdits.join(", ") || "(none)"}`,
						].join("\n"),
					),
				);
			}
		}

		const stagingTracePath = resolveRecordingPath(
			suiteName,
			scenario.name,
			stagingSessionId,
			runOptions?.compareArm,
		);
		if (stagingTracePath) {
			try {
				const path = await recordTrace(stagingTracePath, trace);
				if (keepRecordings || debug) {
					logPhase(theme.phase("trace", theme.path(path)));
				}
			} catch (error) {
				failures.push(
					assertionFailure(
						"recordTrace",
						error instanceof Error ? error.message : "failed to record trace",
						"recording_error",
					),
				);
			}
		}

		const deferJudgeToParent = isChildProcess();
		let judgeVerdicts: JudgeVerdictResult[] | undefined;
		if (judge && !deferJudgeToParent) {
			const criteria = collectJudgeCriteria(scenario.rubric);
			if (criteria.length > 0) {
				logPhase(theme.judgePhase(criteria.length), { last: true });
			}
			const judged = await runJudgeRubric(trace, scenario.rubric, runCwd, host);
			failures.push(...judged.failures);
			trace = judged.trace;
			judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria, judged.verdicts);
		}

		const durationMs = Math.round(performance.now() - started);

		if (isChildProcess() && stagingSessionId && runOptions?.writeSidecar !== false) {
			await writeStagingResult(
				getStagingResultPath(stagingSessionId, suiteName, scenario.name, runOptions?.compareArm),
				{
					passed: failures.length === 0,
					failures,
					durationMs,
					contextMode,
					contextFiles,
					hostInput,
				},
			);
		}

		if (worktreeHandle) {
			await worktreeHandle.cleanup();
			if (activeWorktreeCleanup === worktreeHandle.cleanup) {
				activeWorktreeCleanup = undefined;
			}
			if (callerHeadBefore) {
				await restoreActiveCallerHead();
			}
			worktreeHandle = undefined;
		}

		const scenarioResult = finalizeScenarioResult({
			suite: suiteName,
			scenario,
			contextMode,
			contextFiles,
			hostInput,
			failures,
			durationMs,
			judgeVerdicts,
			trace,
			agentUsage: session.usage ?? trace?.usage,
		});
		const { passed, story } = scenarioResult;
		const armMetrics = {
			id: runOptions?.compareArm ?? "cell",
			label: runOptions?.compareArm ?? "cell",
			prompt: scenario.prompt,
			trace,
		};
		const turns = compareArmTurns(armMetrics);
		const tokens = compareArmTokens(armMetrics);
		const tools = trace.toolCalls.length;
		emitViewerEvent({
			type: "cell_finished",
			...viewerEnvelope,
			passed,
			durationMs,
			failures: failures.map((failure) => ({
				matcher: failure.matcher,
				message: failure.message,
			})),
			metrics: {
				...(turns !== undefined ? { turns } : {}),
				...(tokens !== undefined ? { tokens } : {}),
				tools,
			},
		});
		if (judgeVerdicts && judgeVerdicts.length > 0) {
			emitViewerEvent({
				type: "judge",
				...viewerEnvelope,
				verdicts: judgeVerdicts.map((verdict) => ({
					id: verdict.id,
					question: verdict.question,
					pass: verdict.pass,
					rationale: verdict.rationale,
				})),
			});
		}
		if (!suppressEmit) {
			const debugBundleDir = await maybeWriteDebugBundle({
				debug,
				cwd,
				suitesDir,
				rubricsDir,
				stagingSessionId,
				debugDir,
				suiteName,
				scenario,
				host,
				result: scenarioResult,
				trace,
				timeoutMs,
				worktree,
				judge,
				allowUserInput,
				keepRecordings,
				authMode: getProcessAuthMode(),
			});
			scenarioResult.debugBundleDir = debugBundleDir;
			emitViewerEvent({
				type: "scenario_result",
				...viewerEnvelope,
				result: scenarioResult,
			});

			emitScenarioVerdict({
				passed,
				index: scenarioIndex,
				total: scenarioTotal,
				name: scenario.name,
				durationMs,
				totalTokens: totalTokensFromScenarioUsage(scenarioResult.usage, trace?.usage),
				judgeVerdicts,
				failures,
				story,
				debug,
				debugBundleDir,
			});
		}

		return scenarioResult;
	} finally {
		if (useWorktree && callerTreeBefore !== undefined) {
			const callerTreeAfter = await captureWorkingTreeStatus(cwd).catch(() => "");
			const ignoreRoots = resolveHarnessArtifactIgnoreRoots(cwd, getLiveStagingRootOverride());
			const leaked = filterWorkingTreeLeaks(
				findWorkingTreeLeak(callerTreeBefore, callerTreeAfter),
				ignoreRoots,
				cwd,
			);
			if (leaked.length > 0) {
				await restoreWorkingTreePaths(cwd, porcelainPathsFromLines(leaked)).catch(() => undefined);
			}
		}
		if (worktreeHandle) {
			await worktreeHandle.cleanup();
			if (activeWorktreeCleanup === worktreeHandle.cleanup) {
				activeWorktreeCleanup = undefined;
			}
		}
		if (activeCallerHeadRestore) {
			await restoreActiveCallerHead().catch(() => undefined);
		}
	}
}

async function runCompareAgentTestOnce(
	cwd: string,
	suiteName: string,
	scenario: AgentScenario,
	defaultHost: AgentHost,
	defaultContextMode?: AgentScenario["contextMode"],
	defaultProfile?: AgentScenario["profile"],
	defaultSkills?: SkillContextSetting,
	defaultContextSources?: string[],
	defaultMcpServers?: Record<string, McpServerConfig>,
	defaultWorkspace?: string,
	defaultAllowUserSkills?: boolean,
	judge?: boolean,
	worktree?: boolean,
	stagingSessionId?: string,
	scenarioIndex?: number,
	scenarioTotal?: number,
	timeoutMs?: number,
	allowUserInput?: boolean,
	debugFlag?: boolean,
	debugDir?: string,
	suitesDir = "agent-suites",
	keepRecordings?: boolean,
	rubricsDir?: string,
	runOptions?: { suppressEmit?: boolean },
): Promise<ScenarioResult> {
	const started = performance.now();
	const debug = isDebugEnabled({ debug: debugFlag });
	const suppressEmit = runOptions?.suppressEmit === true;
	const host = scenario.host ?? defaultHost;
	if (scenarioIndex !== undefined && scenarioTotal !== undefined) {
		logProgress(theme.scenarioTitle(scenarioIndex, scenarioTotal, scenario.name, host));
	} else {
		logProgress(theme.scenarioLabel(scenario.name, host));
	}
	logScenarioDescription(scenario.description);

	const resolvedArms = resolveCompareArms(scenario.compare);
	const shared = {
		cwd,
		suiteName,
		defaultHost,
		defaultContextMode,
		defaultProfile,
		defaultSkills,
		defaultContextSources,
		defaultMcpServers,
		defaultWorkspace,
		defaultAllowUserSkills,
		worktree,
		stagingSessionId,
		timeoutMs,
		allowUserInput,
		debugFlag,
		debugDir,
		suitesDir,
		keepRecordings,
		rubricsDir,
	};

	const armRuns: CompareArmRun[] = [];
	for (const entry of resolvedArms) {
		const armScenario = applyCompareArm(scenario, entry.id);
		const label = compareArmLabel(entry.arm, entry.id);
		const result = await runAgentTestOnce(
			shared.cwd,
			shared.suiteName,
			armScenario,
			shared.defaultHost,
			shared.defaultContextMode,
			shared.defaultProfile,
			shared.defaultSkills,
			shared.defaultContextSources,
			shared.defaultMcpServers,
			shared.defaultWorkspace,
			shared.defaultAllowUserSkills,
			false,
			shared.worktree,
			shared.stagingSessionId,
			undefined,
			undefined,
			shared.timeoutMs,
			shared.allowUserInput,
			shared.debugFlag,
			shared.debugDir,
			shared.suitesDir,
			shared.keepRecordings,
			shared.rubricsDir,
			{ suppressEmit: true, compareArm: entry.id, writeSidecar: false },
		);
		armRuns.push({ id: entry.id, label, scenario: armScenario, result });
	}
	const durationMs = Math.round(performance.now() - started);
	const scenarioResult = await finalizeCompareArmRuns({
		cwd,
		suite: suiteName,
		scenario,
		host,
		armRuns,
		durationMs,
		judge: Boolean(judge && !isChildProcess()),
		evaluateGates: !isChildProcess(),
	});
	const { passed, story, failures, trace: firstTrace } = scenarioResult;
	if (isChildProcess() && stagingSessionId) {
		const sidecarArms: Record<string, LiveCompareArmSidecar> = {};
		for (const arm of armRuns) {
			sidecarArms[arm.id] = {
				durationMs: arm.result.durationMs,
				contextMode: arm.result.contextMode,
				contextFiles: arm.result.contextFiles,
				hostInput: arm.result.hostInput,
			};
		}
		await writeStagingResult(getStagingResultPath(stagingSessionId, suiteName, scenario.name), {
			passed: failures.length === 0,
			failures,
			durationMs,
			compare: {
				a: sidecarArms.a,
				b: sidecarArms.b,
				arms: sidecarArms,
			},
		});
	}

	if (!suppressEmit) {
		const debugBundleDir = await maybeWriteDebugBundle({
			debug,
			cwd,
			suitesDir,
			rubricsDir,
			stagingSessionId,
			debugDir,
			suiteName,
			scenario,
			host,
			result: scenarioResult,
			trace: firstTrace,
			timeoutMs,
			worktree,
			judge,
			allowUserInput,
			keepRecordings,
			authMode: getProcessAuthMode(),
		});
		scenarioResult.debugBundleDir = debugBundleDir;
		emitViewerEvent({
			type: "scenario_result",
			suite: suiteName,
			scenario: scenario.name,
			host,
			result: scenarioResult,
		});
		emitScenarioVerdict({
			passed,
			index: scenarioIndex,
			total: scenarioTotal,
			name: scenario.name,
			durationMs,
			totalTokens: totalTokensFromScenarioUsage(scenarioResult.usage, firstTrace?.usage),
			judgeVerdicts: scenarioResult.judgeVerdicts,
			failures,
			story,
			debug,
			debugBundleDir,
		});
	}
	return scenarioResult;
}

async function finalizeCompareArmRuns(options: {
	cwd: string;
	suite: string;
	scenario: AgentScenario;
	host: AgentHost;
	armRuns: CompareArmRun[];
	durationMs: number;
	judge: boolean;
	evaluateGates: boolean;
}): Promise<ScenarioResult> {
	const resolvedArms = resolveCompareArms(options.scenario.compare);
	const finalized = finalizeCompareOutcome(
		options.armRuns.map((arm) => ({
			id: arm.id,
			label: arm.label,
			description: compareArmDescription(resolvedArms.find((entry) => entry.id === arm.id)?.arm),
			prompt: arm.scenario.prompt,
			trace: arm.result.trace,
			contextMode: arm.result.contextMode,
			contextFiles: arm.result.contextFiles,
			hostInput: arm.result.hostInput,
			durationMs: arm.result.durationMs,
			passed: !arm.result.failures.some((failure) => failure.category === "rubric_miss"),
			failures: arm.result.failures,
		})),
		options.scenario.compare?.gates,
		{ evaluateGates: false },
	);
	const compareResult = finalized.compare;
	const failures = finalized.failures;
	if (options.judge && options.scenario.compare?.judgeMetrics?.length) {
		for (const arm of compareResult.arms) {
			if (!arm.trace) continue;
			const judged = await runJudgeRubric(
				arm.trace,
				{ judge: options.scenario.compare.judgeMetrics },
				options.cwd,
				options.host,
			);
			arm.trace = judged.trace;
			arm.judgeVerdicts = toJudgeVerdictResults(
				judged.trace,
				options.scenario.compare.judgeMetrics,
				judged.verdicts,
			);
			arm.failures = [...(arm.failures ?? []), ...judged.failures];
			failures.push(
				...prefixCompareFailures(
					arm.label,
					judged.failures.filter((failure) => failure.category !== "rubric_miss"),
				),
			);
		}
	}
	if (options.evaluateGates) finalizeCompareGates(compareResult, failures);
	const compareArms = compareResultArms(compareResult);
	const firstTrace = compareArms[0]?.trace;
	let judgeVerdicts: JudgeVerdictResult[] | undefined;
	if (
		options.judge &&
		failures.every((failure) => failure.category === "rubric_miss") &&
		compareArms.length > 0 &&
		compareArms.every((arm) => arm.trace)
	) {
		const criteria = collectCompareJudgeCriteria(options.scenario.rubric);
		if (criteria.length > 0) logPhase(theme.judgePhase(criteria.length), { last: true });
		const judged = await runCompareJudgeRubric(
			compareResult,
			options.scenario.rubric,
			options.cwd,
			options.host,
		);
		failures.push(...judged.failures);
		if (firstTrace) {
			judgeVerdicts = toJudgeVerdictResults(
				{ ...firstTrace, judgeVerdicts: judged.verdicts },
				criteria,
				judged.verdicts,
			);
		}
	}
	return finalizeScenarioResult({
		suite: options.suite,
		scenario: options.scenario,
		failures,
		durationMs: options.durationMs,
		judgeVerdicts,
		trace: firstTrace,
		compare: compareResult,
		storyCompare: attachCompareStoryResults(compareStoryFields(options.scenario), compareResult),
		agentUsage: sumUsageParts(options.armRuns.map((arm) => arm.result.agentUsage)),
	});
}

/** Finalize viewer-scheduled compare arms through the same domain and judge path as the CLI. */
export async function finalizeScheduledCompareScenario(options: {
	cwd: string;
	suite: string;
	scenario: ViewerCatalogScenario;
	host: AgentHost;
	armResults: Map<string, ScenarioResult>;
	judge?: boolean;
}): Promise<ScenarioResult> {
	const compareArms = options.scenario.compare ?? [];
	const scenario: AgentScenario = {
		name: options.scenario.name,
		description: options.scenario.description,
		prompt: options.scenario.prompt,
		rubric: options.scenario.rubric,
		compare: {
			arms: compareArms.map((arm) => ({
				id: arm.id,
				label: arm.label,
				description: arm.description,
				prompt: arm.prompt,
			})),
			gates: options.scenario.gates,
			judgeMetrics: options.scenario.judgeMetrics,
		},
	};
	const armRuns = compareArms.flatMap((arm) => {
		const result = options.armResults.get(arm.id);
		return result
			? [
					{
						id: arm.id,
						label: arm.label,
						scenario: applyCompareArm(scenario, arm.id),
						result,
					},
				]
			: [];
	});
	return finalizeCompareArmRuns({
		cwd: options.cwd,
		suite: options.suite,
		scenario,
		host: options.host,
		armRuns,
		durationMs: Math.max(0, ...armRuns.map((arm) => arm.result.durationMs)),
		judge: options.judge !== false,
		evaluateGates: true,
	});
}

async function loadCompareResultFromStaging(
	stagingSessionId: string,
	suiteName: string,
	scenario: AgentScenario,
): Promise<ScenarioCompareResult> {
	const resolved = resolveCompareArms(scenario.compare);
	const arms = [];
	for (const entry of resolved) {
		const armScenario = applyCompareArm(scenario, entry.id);
		let trace: Awaited<ReturnType<typeof loadStagingTrace>> | undefined;
		try {
			trace = await loadStagingTrace(
				getStagingTracePath(stagingSessionId, suiteName, scenario.name, entry.id),
			);
		} catch {
			trace = undefined;
		}
		arms.push({
			id: entry.id,
			label: compareArmLabel(entry.arm, entry.id),
			description: compareArmDescription(entry.arm),
			prompt: armScenario.prompt,
			trace,
			passed: trace ? assertRubric(trace, armScenario.rubric).length === 0 : undefined,
			failures: trace ? assertRubric(trace, armScenario.rubric) : undefined,
		});
	}
	return buildCompareResult(arms, scenario.compare?.gates);
}

async function runCompareJudgeRubric(
	compare: ScenarioCompareResult,
	rubric: ScenarioRubric,
	runCwd: string,
	host: AgentHost,
): Promise<{
	failures: AssertionFailure[];
	verdicts: NonNullable<Awaited<ReturnType<typeof judgeCompareTraces>>["verdicts"]>;
}> {
	const criteria = collectCompareJudgeCriteria(rubric);
	const arms = compareResultArms(compare).filter(
		(arm): arm is typeof arm & { trace: NonNullable<typeof arm.trace> } => arm.trace !== undefined,
	);
	if (criteria.length === 0 || arms.length < 2) {
		return { failures: [], verdicts: [] };
	}
	const pair =
		arms.length === 2 && arms[0] && arms[1]
			? {
					aLabel: arms[0].label,
					a: arms[0].trace,
					bLabel: arms[1].label,
					b: arms[1].trace,
				}
			: undefined;
	const result = await judgeCompareTraces(
		pair ?? {
			arms: arms.map((arm) => ({ label: arm.label, trace: arm.trace })),
		},
		criteria,
		{ cwd: runCwd, host },
	);
	if (result.skipped) {
		return {
			failures: [assertionFailure("judge", result.error ?? "judge skipped", "judge_infra")],
			verdicts: [],
		};
	}
	const failures: AssertionFailure[] = [];
	for (const verdict of result.verdicts) {
		if (!verdict.pass) {
			const category = verdict.infraError
				? "judge_infra"
				: verdict.parseError
					? "judge_parse"
					: "rubric_miss";
			failures.push(assertionFailure(`judge:${verdict.id}`, verdict.rationale, category));
		}
	}
	if (result.error && !result.verdicts.some((verdict) => !verdict.pass)) {
		failures.push(assertionFailure("judge", result.error, "judge_infra"));
	}
	return { failures, verdicts: result.verdicts };
}

async function runJudgeRubric(
	trace: AgentTrace,
	rubric: ScenarioRubric,
	runCwd: string,
	host: AgentHost,
): Promise<{
	trace: AgentTrace;
	failures: AssertionFailure[];
	verdicts: NonNullable<Awaited<ReturnType<typeof judgeTrace>>["verdicts"]>;
}> {
	const criteria = collectJudgeCriteria(rubric);
	if (criteria.length === 0) {
		return { trace, failures: [], verdicts: [] };
	}

	const result = await judgeTrace(trace, criteria, { cwd: runCwd, host });
	if (result.skipped) {
		return {
			trace,
			failures: [assertionFailure("judge", result.error ?? "judge skipped", "judge_infra")],
			verdicts: [],
		};
	}

	const judgedTrace: AgentTrace = { ...trace, judgeVerdicts: result.verdicts };
	const failures: AssertionFailure[] = [];
	for (const verdict of result.verdicts) {
		if (!verdict.pass) {
			const category = verdict.infraError
				? "judge_infra"
				: verdict.parseError
					? "judge_parse"
					: "rubric_miss";
			failures.push(assertionFailure(`judge:${verdict.id}`, verdict.rationale, category));
		}
	}
	// Top-level only when no failing verdict already covers the error (avoids
	// double-filing parse/infra failures as both judge:<id> and judge).
	if (result.error && !result.verdicts.some((v) => !v.pass)) {
		failures.push(assertionFailure("judge", result.error, "judge_infra"));
	}
	return { trace: judgedTrace, failures, verdicts: result.verdicts };
}

function suiteNameFromPath(suitePath: string): string {
	return basename(dirname(suitePath));
}

export async function runAllSuites(options: {
	cwd: string;
	suitesDir: string;
	host?: AgentHost;
	hosts?: readonly AgentHost[];
	filter?: string;
	scenarioFilter?: string;
	judge?: boolean;
	worktree?: boolean;
	stagingSessionId?: string;
	keepRecordings?: boolean;
	timeoutMs?: number;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
	scenarioRetries?: number;
	rubricsDir?: string;
	adapterModules?: string[];
	authMode?: HostAuthMode;
	compareArm?: CompareArmId;
	workers?: number;
}): Promise<SuiteRunReport[]> {
	const previousAuthMode = getProcessAuthMode();
	if (options.authMode !== undefined) {
		setProcessAuthMode(options.authMode);
	}
	try {
		return await runAllSuitesBody(options);
	} finally {
		if (options.authMode !== undefined) {
			setProcessAuthMode(previousAuthMode);
		}
	}
}

async function runAllSuitesBody(options: {
	cwd: string;
	suitesDir: string;
	host?: AgentHost;
	hosts?: readonly AgentHost[];
	filter?: string;
	scenarioFilter?: string;
	judge?: boolean;
	worktree?: boolean;
	stagingSessionId?: string;
	keepRecordings?: boolean;
	timeoutMs?: number;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
	scenarioRetries?: number;
	rubricsDir?: string;
	adapterModules?: string[];
	authMode?: HostAuthMode;
	compareArm?: CompareArmId;
	workers?: number;
}): Promise<SuiteRunReport[]> {
	const suitePaths = await discoverSuites(resolve(options.cwd, options.suitesDir));
	const filtered = options.filter
		? suitePaths.filter((suitePath) => {
				const suiteName = suiteNameFromPath(suitePath);
				return suiteName === options.filter || suitePath.includes(`/${options.filter}/`);
			})
		: suitePaths;

	const cliHosts = uniqueHosts(options.hosts ?? (options.host ? [options.host] : undefined));
	const reports: SuiteRunReport[] = [];
	for (const suitePath of filtered) {
		const suite = await loadSuiteFile(suitePath, { rubricsDir: options.rubricsDir });
		const hosts = resolveSuiteHosts({
			cliHosts,
			suiteHosts: suite.hosts,
			defaultHost: suite.defaults?.host,
		});
		const hostLocked = hosts.length > 1;
		for (const host of hosts) {
			reports.push(
				await runSuite({
					cwd: options.cwd,
					suitePath,
					host,
					hostLocked,
					scenarioFilter: options.scenarioFilter,
					judge: options.judge,
					worktree: options.worktree,
					stagingSessionId: options.stagingSessionId,
					keepRecordings: options.keepRecordings,
					suitesDir: options.suitesDir,
					suiteFilter: options.filter,
					timeoutMs: options.timeoutMs,
					allowUserInput: options.allowUserInput,
					debug: options.debug,
					debugDir: options.debugDir,
					scenarioRetries: options.scenarioRetries,
					rubricsDir: options.rubricsDir,
					adapterModules: options.adapterModules,
					authMode: options.authMode ?? getProcessAuthMode(),
					compareArm: options.compareArm,
					workers: options.workers,
				}),
			);
		}
	}
	return reports;
}

export { discoverSuites } from "./discover-suites.js";
