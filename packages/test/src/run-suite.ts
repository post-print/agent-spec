import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

import type {
	AgentHost,
	AgentTrace,
	JudgeCriterion,
	McpServerConfig,
	RoutingContract,
	SkillContextSetting,
} from "@post-print/agent-harness";
import {
	cancelActiveClaudeRun,
	cancelActiveCursorRun,
	captureWorkingTreeStatus,
	createScenarioWorktree,
	enrichTrace,
	filterWorkingTreeLeaks,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
	judgeTrace,
	loadContext,
	loadUnifiedDiffPaths,
	mergeMcpServers,
	partitionSeedCollateralLeaks,
	porcelainPathsFromLines,
	resolveHarnessArtifactIgnoreRoots,
	restoreWorkingTreePaths,
	runAgent,
	traceEditsOutsideWorktree,
	traceHasUserInputTool,
} from "@post-print/agent-harness";

import { collectDebugEnvironment, getDebugBundleDir, writeDebugBundle } from "./debug-bundle.js";
import { discoverSuites } from "./discover-suites.js";
import { assertRubric } from "./expect.js";
import { assertionFailure } from "./failures.js";
import {
	failuresForLiveSubprocessExit,
	killActiveLiveChildren,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
	spawnLiveScenario,
} from "./live-isolation.js";
import { resolveLiveTimeoutMs } from "./live-timeout.js";
import { loadSuiteFile } from "./load-suite.js";
import { formatDuration, logPhase, logProgress, logVerdict, withHeartbeat } from "./progress.js";
import {
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRootOverride,
	getLiveStagingSessionRoot,
	getStagingAgentStartPath,
	getStagingResultPath,
	getStagingTracePath,
	loadStagingResult,
	loadStagingTrace,
	recordTrace,
	resolveRecordingPath,
	setLiveStagingRootOverride,
	writeAgentStartMarker,
	writeStagingResult,
} from "./record-trace.js";
import { resolveScenarioRetryMaxAttempts, shouldRetryAnnounceStopFlake } from "./scenario-retry.js";
import {
	type CallerHeadSnapshot,
	captureCallerHead,
	restoreCallerHeadIfSeedCommit,
	seedScenarioWorktree,
} from "./scenario-seed.js";
import { buildScenarioResultUsage, totalTokensFromScenarioUsage } from "./scenario-usage.js";
import { summarizeReportResults } from "./suite-summary.js";
import { theme } from "./theme.js";
import type {
	AgentScenario,
	AgentSuiteDefaults,
	AssertionFailure,
	JudgeRubricItem,
	JudgeVerdictResult,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";
import { validateSuiteFile } from "./validate-suite.js";

const require = createRequire(import.meta.url);
const packageVersion = (require("../package.json") as { version: string }).version;

let activeWorktreeCleanup: (() => Promise<void>) | undefined;
let activeCallerHeadRestore: { cwd: string; snapshot: CallerHeadSnapshot } | undefined;
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
	const scenarios = options.scenarioFilter
		? suite.scenarios.filter((scenario) => scenario.name === options.scenarioFilter)
		: suite.scenarios;

	if (options.scenarioFilter && scenarios.length === 0) {
		throw new Error(`Scenario not found: ${options.scenarioFilter}`);
	}

	const filteredTotal = scenarios.length;
	const parentCounters = parentScenarioCounters();
	const displayTotal = parentCounters?.total ?? filteredTotal;
	const isolateLive =
		liveScenarioIsolationEnabled() && !options.scenarioFilter && filteredTotal > 1;
	let previousIsolatedExitCode: number | undefined;

	if (shouldPrintSuiteChrome()) {
		logProgress(`\n${theme.suiteHeader(suite.name, defaultHost, displayTotal)}`);
		if (isolateLive) {
			logProgress(`  ${theme.isolationNote()}`);
		}
	}

	for (let index = 0; index < scenarios.length; index++) {
		const scenario = scenarios[index];
		if (!scenario) {
			continue;
		}

		const scenarioIndex = parentCounters?.index ?? index + 1;
		const scenarioTotal = displayTotal;

		if (isolateLive) {
			if (scenario.skip) {
				const skipLabel = `[${scenarioIndex}/${scenarioTotal}] ${scenario.name}`;
				logProgress(theme.skipped(skipLabel));
				results.push({
					suite: suite.name,
					scenario: scenario.name,
					passed: true,
					failures: [],
					skipped: true,
					durationMs: 0,
				});
				continue;
			}

			const started = performance.now();
			const debug = isDebugEnabled(options);
			const maxAttempts = !isChildProcess()
				? resolveScenarioRetryMaxAttempts(options.scenarioRetries)
				: 1;
			let attempts = 0;
			let failures: AssertionFailure[] = [];
			let scenarioTrace: AgentTrace | undefined;
			let previousAttemptExitCode = previousIsolatedExitCode;

			while (true) {
				attempts++;
				const exitCode = await spawnLiveScenario({
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
					scenarioIndex: index + 1,
					scenarioTotal: filteredTotal,
					timeoutMs: resolveLiveTimeoutMs(options.timeoutMs),
					noTimeout: options.timeoutMs === 0,
					allowUserInput: options.allowUserInput,
					debug: options.debug,
					debugDir: options.debugDir,
					previousExitCode: previousAttemptExitCode,
				});
				previousAttemptExitCode = exitCode;
				previousIsolatedExitCode = exitCode;
				failures = [];
				scenarioTrace = undefined;

				if (exitCode !== 0) {
					const childResult =
						options.stagingSessionId !== undefined
							? await loadStagingResult(
									getStagingResultPath(options.stagingSessionId, suite.name, scenario.name),
								)
							: undefined;
					failures.push(...failuresForLiveSubprocessExit(exitCode, childResult));
				}
				if (options.stagingSessionId) {
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
			if (failures.length === 0 && options.judge !== false && scenarioTrace) {
				const criteria = normalizeJudgeCriteria(scenario.rubric.judge);
				if (criteria.length > 0) {
					releaseLiveMemory();
					logPhase(theme.judgePhase(criteria.length), { last: true });
					try {
						const judged = await runJudgeRubric(scenarioTrace, scenario.rubric, options.cwd);
						failures.push(...judged.failures);
						scenarioTrace = judged.trace;
						judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria, judged.verdicts);
					} catch (error) {
						failures.push(
							assertionFailure(
								"judge",
								error instanceof Error ? error.message : "failed to load staging trace for judge",
								"judge_infra",
							),
						);
					}
				}
			}

			const durationMs = Math.round(performance.now() - started);
			const passed = failures.length === 0;
			const usageFields = buildScenarioResultUsage({
				agentUsage: scenarioTrace?.usage,
				judgeVerdicts,
			});
			const scenarioResult: ScenarioResult = {
				suite: suite.name,
				scenario: scenario.name,
				compareId: scenario.compareId,
				passed,
				failures,
				durationMs,
				attempts,
				judgeVerdicts,
				trace: scenarioTrace,
				...usageFields,
			};
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
				debug,
				debugBundleDir,
			});
			results.push(scenarioResult);
			releaseLiveMemory();
			continue;
		}

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
			}),
		);
		releaseLiveMemory();
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

function mergeContextSources(
	defaults?: string[],
	scenarioSources?: string[],
): string[] | undefined {
	const merged = [...(defaults ?? []), ...(scenarioSources ?? [])].filter(
		(value) => typeof value === "string" && value.trim().length > 0,
	);
	return merged.length > 0 ? merged : undefined;
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
	try {
		return await runAgentTestBody({ ...options, stagingSessionId });
	} finally {
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
			"Replay-based testing is deprecated and no longer supported; use Cursor or Claude.",
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
			options.defaults?.profile,
			options.defaults?.skills,
			options.defaults?.contextSources,
			options.defaults?.mcpServers,
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
			{ suppressEmit: maxAttempts > 1 },
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
	defaultProfile?: AgentScenario["profile"],
	defaultSkills?: SkillContextSetting,
	defaultContextSources?: string[],
	defaultMcpServers?: Record<string, McpServerConfig>,
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

	if (scenario.skip) {
		const skipLabel =
			scenarioIndex !== undefined && scenarioTotal !== undefined
				? `[${scenarioIndex}/${scenarioTotal}] ${scenario.name}`
				: scenario.name;
		logProgress(theme.skipped(skipLabel));
		return {
			suite: suiteName,
			scenario: scenario.name,
			passed: true,
			failures: [],
			skipped: true,
			durationMs: 0,
		};
	}

	const host = scenario.host ?? defaultHost;
	const profile = scenario.profile ?? defaultProfile ?? (host === "cursor" ? "cursor" : "shared");
	const skills = scenario.skills ?? defaultSkills;
	const contextSources = mergeContextSources(defaultContextSources, scenario.contextSources);
	const mcpServers = mergeMcpServers(defaultMcpServers, scenario.mcpServers);
	const liveTimeoutMs = resolveLiveTimeoutMs(timeoutMs);
	const failOnUserInput = !allowUserInput;

	if (scenarioIndex !== undefined && scenarioTotal !== undefined) {
		logProgress(theme.scenarioTitle(scenarioIndex, scenarioTotal, scenario.name, host));
	} else {
		logProgress(theme.scenarioLabel(scenario.name, host));
	}

	const useWorktree = worktree !== false && !process.env.AGENT_TEST_NO_WORKTREE;
	let worktreeHandle: Awaited<ReturnType<typeof createScenarioWorktree>> | undefined;
	let callerHeadBefore: Awaited<ReturnType<typeof captureCallerHead>> | undefined;
	const callerTreeBefore = useWorktree ? await captureWorkingTreeStatus(cwd) : undefined;
	if (useWorktree) {
		if (scenario.seedPatch) {
			callerHeadBefore = await captureCallerHead(cwd);
			setCallerHeadRestore(cwd, callerHeadBefore);
		}
		worktreeHandle = await createScenarioWorktree(cwd, `${suiteName}-${scenario.name}`);
		activeWorktreeCleanup = worktreeHandle.cleanup;
		logPhase(theme.phase("worktree", theme.path(worktreeHandle.path)));
		if (scenario.seedPatch) {
			logPhase(theme.phase("seed", theme.basename(scenario.seedPatch)));
			await seedScenarioWorktree(cwd, worktreeHandle.path, scenario.seedPatch, {
				stageOnly: scenario.seedStageOnly === true,
			});
		}
	} else {
		logPhase(theme.phase("worktree", theme.phaseDim("disabled (AGENT_TEST_ALLOW_IN_PLACE=1)")));
	}
	const runCwd = worktreeHandle?.path ?? cwd;

	try {
		logPhase(theme.phase("context"));
		// Worktree runs code in an isolated checkout; load rules/AGENTS from caller cwd
		// so uncommitted .cursor/rules and AGENTS.md edits apply during dogfood.
		const contextRoot = useWorktree ? cwd : runCwd;
		const context = await loadContext({
			cwd: contextRoot,
			profile,
			skills,
			contextSources,
		});
		logPhase(theme.phase("agent"));

		const outputContract = outputContractForRubric(scenario.rubric);
		const agentStartMarkerPath =
			isChildProcess() && stagingSessionId
				? getStagingAgentStartPath(stagingSessionId, suiteName, scenario.name)
				: undefined;
		const agentStarted = performance.now();
		const session = await withHeartbeat(
			runAgent({
				host,
				cwd: runCwd,
				context,
				profile,
				prompt: scenario.prompt,
				outputContract,
				mcpServers,
				timeoutMs: liveTimeoutMs,
				failOnUserInput,
				onDeadlineStart: agentStartMarkerPath
					? () => writeAgentStartMarker(agentStartMarkerPath)
					: undefined,
			}),
			{ started: agentStarted },
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

		logPhase(theme.phase("rubric"));
		failures.push(
			...assertRubric(trace, scenario.rubric, {
				skillsMode: context.skillsMode,
			}),
		);

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

		const stagingTracePath = resolveRecordingPath(suiteName, scenario.name, stagingSessionId);
		if (stagingTracePath) {
			try {
				const path = await recordTrace(stagingTracePath, trace);
				logPhase(theme.phase("trace", theme.path(path)));
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
			const criteria = normalizeJudgeCriteria(scenario.rubric.judge);
			if (criteria.length > 0) {
				logPhase(theme.judgePhase(criteria.length), { last: true });
			}
			const judged = await runJudgeRubric(trace, scenario.rubric, runCwd);
			failures.push(...judged.failures);
			trace = judged.trace;
			judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria, judged.verdicts);
		}

		const durationMs = Math.round(performance.now() - started);

		if (isChildProcess() && stagingSessionId) {
			await writeStagingResult(getStagingResultPath(stagingSessionId, suiteName, scenario.name), {
				passed: failures.length === 0,
				failures,
				durationMs,
			});
		}

		if (worktreeHandle) {
			const willJudge =
				Boolean(judge) &&
				!isChildProcess() &&
				normalizeJudgeCriteria(scenario.rubric.judge).length > 0;
			logPhase(theme.phase("cleanup"), { last: !willJudge });
			await worktreeHandle.cleanup();
			if (activeWorktreeCleanup === worktreeHandle.cleanup) {
				activeWorktreeCleanup = undefined;
			}
			if (callerHeadBefore) {
				await restoreActiveCallerHead();
			}
			worktreeHandle = undefined;
		}

		const scenarioResult: ScenarioResult = {
			suite: suiteName,
			scenario: scenario.name,
			compareId: scenario.compareId,
			passed: failures.length === 0,
			failures,
			durationMs,
			judgeVerdicts,
			trace,
			...buildScenarioResultUsage({
				agentUsage: session.usage ?? trace?.usage,
				judgeVerdicts,
			}),
		};
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
			});
			scenarioResult.debugBundleDir = debugBundleDir;

			emitScenarioVerdict({
				passed: failures.length === 0,
				index: scenarioIndex,
				total: scenarioTotal,
				name: scenario.name,
				durationMs,
				totalTokens: totalTokensFromScenarioUsage(scenarioResult.usage, trace?.usage),
				judgeVerdicts,
				failures,
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
			logPhase(theme.phase("cleanup"), { last: true });
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

async function runJudgeRubric(
	trace: AgentTrace,
	rubric: ScenarioRubric,
	runCwd: string,
): Promise<{
	trace: AgentTrace;
	failures: AssertionFailure[];
	verdicts: NonNullable<Awaited<ReturnType<typeof judgeTrace>>["verdicts"]>;
}> {
	const criteria = normalizeJudgeCriteria(rubric.judge);
	if (criteria.length === 0) {
		return { trace, failures: [], verdicts: [] };
	}

	const result = await judgeTrace(trace, criteria, { cwd: runCwd });
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
}): Promise<SuiteRunReport[]> {
	const suitePaths = await discoverSuites(resolve(options.cwd, options.suitesDir));
	const filtered = options.filter
		? suitePaths.filter((suitePath) => {
				const suiteName = suiteNameFromPath(suitePath);
				return suiteName === options.filter || suitePath.includes(`/${options.filter}/`);
			})
		: suitePaths;

	const reports: SuiteRunReport[] = [];
	for (const suitePath of filtered) {
		reports.push(
			await runSuite({
				cwd: options.cwd,
				suitePath,
				host: options.host,
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
			}),
		);
	}
	return reports;
}

export { discoverSuites } from "./discover-suites.js";
