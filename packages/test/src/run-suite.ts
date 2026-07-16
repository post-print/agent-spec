import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

import type {
	AgentHost,
	AgentTrace,
	JudgeCriterion,
	RoutingContract,
	SkillContextSetting,
} from "@post-print/agent-harness";
import {
	captureWorkingTreeStatus,
	createScenarioWorktree,
	enrichTrace,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
	judgeTrace,
	loadContext,
	runAgent,
	traceHasUserInputTool,
} from "@post-print/agent-harness";

import { collectDebugEnvironment, getDebugBundleDir, writeDebugBundle } from "./debug-bundle.js";
import { discoverSuites } from "./discover-suites.js";
import { assertRubric } from "./expect.js";
import { assertionFailure } from "./failures.js";
import {
	failuresForLiveSubprocessExit,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
	spawnLiveScenario,
} from "./live-isolation.js";
import { resolveLiveTimeoutMs } from "./live-timeout.js";
import { loadSuiteFile } from "./load-suite.js";
import { formatDuration, logPhase, logProgress, logVerdict, withHeartbeat } from "./progress.js";
import {
	getLiveStagingSessionRoot,
	getStagingAgentStartPath,
	getStagingResultPath,
	getStagingTracePath,
	loadStagingResult,
	loadStagingTrace,
	recordTrace,
	resolveRecordingPath,
	writeAgentStartMarker,
	writeStagingResult,
} from "./record-trace.js";
import {
	type CallerHeadSnapshot,
	captureCallerHead,
	restoreCallerHeadIfSeedCommit,
	seedScenarioWorktree,
} from "./scenario-seed.js";
import { theme } from "./theme.js";
import type {
	AgentScenario,
	AssertionFailure,
	JudgeRubricItem,
	JudgeVerdictResult,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";

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

/** Best-effort worktree cleanup when live runs are interrupted (SIGINT/SIGTERM). */
export function registerLiveRunHandlers(): void {
	if (liveSignalHandlersRegistered) {
		return;
	}
	liveSignalHandlersRegistered = true;

	const interrupt = (code: number) => {
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
	/** Write live traces after a fully passing run. */
	record?: boolean;
	/** Overwrite committed replayTrace paths (default: write staging traces under $TMPDIR). */
	recordFixtures?: boolean;
	/** Run harness LLM judge for rubric.judge criteria (live hosts only). */
	judge?: boolean;
	/** Isolate each live scenario in a detached git worktree. */
	worktree?: boolean;
	/** Session id for live staging traces under $TMPDIR (see record-trace.ts). */
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
			rawSdkStatus?: string;
			sdkError?: { message?: string; code?: string };
			attempt?: number;
			durationMs?: number;
			transcriptChars?: number;
			promptChars?: number;
		};
		return {
			id: extended.id,
			question: questionForCriterion(criteria, extended.id),
			pass: extended.pass,
			rationale: extended.rationale,
			infraError: extended.infraError,
			rawSdkStatus: extended.rawSdkStatus,
			sdkError: extended.sdkError,
			attempt: extended.attempt,
			durationMs: extended.durationMs,
			transcriptChars: extended.transcriptChars,
			promptChars: extended.promptChars,
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
	live: boolean;
	allowUserInput?: boolean;
	keepRecordings?: boolean;
}): Promise<string | undefined> {
	if (!options.debug || options.result.passed || options.result.skipped) {
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
				isolateLive: options.live && liveScenarioIsolationEnabled(),
			}),
			rerun: {
				cliPath,
				cwd: options.cwd,
				suitesDir: options.suitesDir,
				suite: options.suiteName,
				scenario: options.scenario.name,
				live: options.live,
				host: options.host,
				judge: options.judge,
				worktree: options.worktree,
				timeoutMs: options.timeoutMs,
				noTimeout: options.timeoutMs === 0,
				allowUserInput: options.allowUserInput,
				debugDir: options.debugDir,
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
	const suite = await loadSuiteFile(options.suitePath);
	const defaultHost = options.host ?? suite.defaults?.host ?? "replay";
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
	const isLiveSuite = defaultHost !== "replay";
	const isolateLive =
		isLiveSuite && liveScenarioIsolationEnabled() && !options.scenarioFilter && filteredTotal > 1;

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
			const exitCode = await spawnLiveScenario({
				cwd: options.cwd,
				suiteName: suite.name,
				scenarioName: scenario.name,
				suitesDir: options.suitesDir ?? "agent-suites",
				suiteFilter: options.suiteFilter ?? suite.name,
				stagingSessionId: options.stagingSessionId,
				keepRecordings: options.keepRecordings,
				recordFixtures: options.recordFixtures,
				worktree: options.worktree,
				judge: options.judge,
				scenarioIndex: index + 1,
				scenarioTotal: filteredTotal,
				timeoutMs: resolveLiveTimeoutMs(options.timeoutMs),
				noTimeout: options.timeoutMs === 0,
				allowUserInput: options.allowUserInput,
				debug: options.debug,
				debugDir: options.debugDir,
			});
			const durationMs = Math.round(performance.now() - started);
			const failures: AssertionFailure[] = [];
			let judgeVerdicts: JudgeVerdictResult[] | undefined;
			let scenarioTrace: AgentTrace | undefined;
			const debug = isDebugEnabled(options);

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
				const tracePath = getStagingTracePath(options.stagingSessionId, suite.name, scenario.name);
				try {
					scenarioTrace = await loadStagingTrace(tracePath);
				} catch {
					// Trace may be missing when the child crashed before recording.
				}
			}
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

			const passed = failures.length === 0;
			const scenarioResult: ScenarioResult = {
				suite: suite.name,
				scenario: scenario.name,
				passed,
				failures,
				durationMs,
				judgeVerdicts,
				trace: scenarioTrace,
			};
			const debugBundleDir = await maybeWriteDebugBundle({
				debug,
				cwd: options.cwd,
				suitesDir: options.suitesDir ?? "agent-suites",
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
				live: true,
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
			await runScenario(
				options.cwd,
				suite.name,
				scenario,
				defaultHost,
				suite.defaults?.profile,
				suite.defaults?.skills,
				options.record,
				options.recordFixtures,
				options.judge,
				options.worktree,
				options.stagingSessionId,
				scenarioIndex,
				scenarioTotal,
				options.timeoutMs,
				options.allowUserInput,
				options.debug,
				options.debugDir,
				options.suitesDir ?? "agent-suites",
				options.keepRecordings,
			),
		);
		if (isLiveSuite) {
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
	};
}

async function runScenario(
	cwd: string,
	suiteName: string,
	scenario: AgentScenario,
	defaultHost: AgentHost,
	defaultProfile?: AgentScenario["profile"],
	defaultSkills?: SkillContextSetting,
	record?: boolean,
	recordFixtures?: boolean,
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
): Promise<ScenarioResult> {
	const started = performance.now();
	const debug = isDebugEnabled({ debug: debugFlag });

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
	const isLive = host !== "replay";
	const liveTimeoutMs = isLive ? resolveLiveTimeoutMs(timeoutMs) : undefined;
	const failOnUserInput = !allowUserInput;

	if (scenarioIndex !== undefined && scenarioTotal !== undefined) {
		logProgress(theme.scenarioTitle(scenarioIndex, scenarioTotal, scenario.name, host));
	} else {
		logProgress(theme.scenarioLabel(scenario.name, host));
	}

	const useWorktree = isLive && worktree !== false && !process.env.AGENT_TEST_NO_WORKTREE;
	let worktreeHandle: Awaited<ReturnType<typeof createScenarioWorktree>> | undefined;
	let callerHeadBefore: Awaited<ReturnType<typeof captureCallerHead>> | undefined;
	const callerTreeBefore = useWorktree ? await captureWorkingTreeStatus(cwd) : undefined;
	if (useWorktree) {
		if (isLive && scenario.seedPatch) {
			callerHeadBefore = await captureCallerHead(cwd);
			setCallerHeadRestore(cwd, callerHeadBefore);
		}
		worktreeHandle = await createScenarioWorktree(cwd, `${suiteName}-${scenario.name}`);
		activeWorktreeCleanup = worktreeHandle.cleanup;
		logPhase(theme.phase("worktree", theme.path(worktreeHandle.path)));
		if (isLive && scenario.seedPatch) {
			logPhase(theme.phase("seed", theme.basename(scenario.seedPatch)));
			await seedScenarioWorktree(cwd, worktreeHandle.path, scenario.seedPatch);
		}
	} else if (isLive) {
		logPhase(theme.phase("worktree", theme.phaseDim("disabled (AGENT_TEST_ALLOW_IN_PLACE=1)")));
	}
	const runCwd = worktreeHandle?.path ?? cwd;

	try {
		logPhase(theme.phase("context"));
		// Live worktree runs code in an isolated checkout; load rules/AGENTS from caller cwd
		// so uncommitted .cursor/rules and AGENTS.md edits apply during dogfood.
		const contextRoot = isLive && useWorktree ? cwd : runCwd;
		const context = await loadContext({ cwd: contextRoot, profile, skills });
		const useReplay = host === "replay";
		if (useReplay) {
			logPhase(theme.phase("replay", theme.path(scenario.replayTrace ?? "trace")));
		} else {
			logPhase(theme.phase("agent"));
		}

		const outputContract = isLive ? outputContractForRubric(scenario.rubric) : undefined;
		const agentStartMarkerPath =
			isChildProcess() && isLive && stagingSessionId
				? getStagingAgentStartPath(stagingSessionId, suiteName, scenario.name)
				: undefined;
		const agentStarted = performance.now();
		const session = await (isLive
			? withHeartbeat(
					runAgent({
						host,
						cwd: runCwd,
						context,
						profile,
						prompt: scenario.prompt,
						outputContract,
						timeoutMs: liveTimeoutMs,
						failOnUserInput,
						onDeadlineStart: agentStartMarkerPath
							? () => writeAgentStartMarker(agentStartMarkerPath)
							: undefined,
					}),
					{ started: agentStarted },
				)
			: runAgent({
					host,
					cwd: runCwd,
					context,
					profile,
					prompt: scenario.prompt,
					replayTracePath: useReplay ? scenario.replayTrace : undefined,
				}));

		if (isLive) {
			logPhase(
				theme.phase(
					"agent",
					`${theme.statusCompleted(session.status)} ${theme.duration(formatDuration(performance.now() - agentStarted))}`,
				),
			);
		}

		let trace = enrichTrace(session.trace);
		const failures: AssertionFailure[] = [];

		if (session.status !== "completed") {
			failures.push(
				assertionFailure(
					"runAgent",
					session.error ?? `agent session ${session.status}`,
					"agent_runtime",
				),
			);
		} else if (isLive && failOnUserInput && traceHasUserInputTool(trace.toolCalls)) {
			failures.push(
				assertionFailure(
					"runAgent",
					"agent trace contains AskQuestion-style user-input tool in headless mode",
					"agent_runtime",
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
			const leaked = findWorkingTreeLeak(callerTreeBefore, callerTreeAfter);
			if (leaked.length > 0) {
				failures.push(
					assertionFailure(
						"workingTreeLeak",
						`live agent mutated caller working tree (use worktree isolation):\n${formatWorkingTreeLeak(leaked)}`,
						"worktree_leak",
					),
				);
			}
		}

		if (record && isLive) {
			const resolved = resolveRecordingPath(
				suiteName,
				scenario.name,
				scenario.replayTrace,
				recordFixtures === true,
				{ repoRoot: cwd, stagingSessionId },
			);
			if (resolved) {
				try {
					const path = await recordTrace(resolved.path, trace);
					const recordLabel = resolved.kind === "fixture" ? "fixture" : "trace";
					logPhase(theme.phase(recordLabel, theme.path(path)));
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
		}

		const deferJudgeToParent = isChildProcess();
		let judgeVerdicts: JudgeVerdictResult[] | undefined;
		if (judge && isLive && !deferJudgeToParent) {
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

		if (isChildProcess() && isLive && stagingSessionId) {
			await writeStagingResult(getStagingResultPath(stagingSessionId, suiteName, scenario.name), {
				passed: failures.length === 0,
				failures,
				durationMs,
			});
		}

		if (worktreeHandle) {
			const willJudge =
				Boolean(judge) &&
				isLive &&
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
			passed: failures.length === 0,
			failures,
			durationMs,
			judgeVerdicts,
			trace,
		};
		const debugBundleDir = await maybeWriteDebugBundle({
			debug,
			cwd,
			suitesDir,
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
			live: isLive,
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
			judgeVerdicts,
			failures,
			debug,
			debugBundleDir,
		});

		return scenarioResult;
	} finally {
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
			failures.push(
				assertionFailure(
					`judge:${verdict.id}`,
					verdict.rationale,
					verdict.infraError ? "judge_infra" : "rubric_miss",
				),
			);
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
	record?: boolean;
	recordFixtures?: boolean;
	judge?: boolean;
	worktree?: boolean;
	stagingSessionId?: string;
	keepRecordings?: boolean;
	timeoutMs?: number;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
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
				record: options.record,
				recordFixtures: options.recordFixtures,
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
			}),
		);
	}
	return reports;
}

export { discoverSuites } from "./discover-suites.js";
