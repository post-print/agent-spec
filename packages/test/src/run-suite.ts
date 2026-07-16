import { basename, dirname, resolve } from "node:path";

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

import { discoverSuites } from "./discover-suites.js";
import { assertRubric } from "./expect.js";
import {
	failuresForLiveSubprocessExit,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
	spawnLiveScenario,
} from "./live-isolation.js";
import { resolveLiveTimeoutMs } from "./live-timeout.js";
import { loadSuiteFile } from "./load-suite.js";
import {
	formatDuration,
	logPhase,
	logProgress,
	logVerdict,
	withHeartbeat,
} from "./progress.js";
import {
	getStagingAgentStartPath,
	getStagingTracePath,
	loadStagingTrace,
	loadStagingResult,
	recordTrace,
	resolveRecordingPath,
	writeAgentStartMarker,
	writeStagingResult,
	getStagingResultPath,
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

let activeWorktreeCleanup: (() => Promise<void>) | undefined;
let activeCallerHeadRestore:
	| { cwd: string; snapshot: CallerHeadSnapshot }
	| undefined;
let liveSignalHandlersRegistered = false;

function setCallerHeadRestore(
	cwd: string,
	snapshot: CallerHeadSnapshot,
): void {
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
					await restoreCallerHeadIfSeedCommit(
						headRestore.cwd,
						headRestore.snapshot,
					).catch(() => undefined);
				}
			})
			.finally(() => process.exit(code));
	};

	process.on("SIGINT", () => interrupt(130));
	process.on("SIGTERM", () => interrupt(143));
}

function releaseLiveMemory(): void {
	const bunGc = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun
		?.gc;
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
}

/** Live-only mode hint from rubric — not part of the user scenario prompt. */
export function outputContractForRubric(
	rubric: ScenarioRubric,
): RoutingContract | undefined {
	if (rubric.routingBlock) {
		return "hands-off";
	}
	if (rubric.handsOnRouting) {
		return "hands-on";
	}
	return undefined;
}

function normalizeJudgeCriteria(
	judge: JudgeRubricItem[] | undefined,
): JudgeCriterion[] {
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
): JudgeVerdictResult[] {
	return (trace.judgeVerdicts ?? []).map((verdict) => ({
		id: verdict.id,
		question: questionForCriterion(criteria, verdict.id),
		pass: verdict.pass,
		rationale: verdict.rationale,
	}));
}

function rubricFailuresOnly(failures: AssertionFailure[]): AssertionFailure[] {
	return failures.filter((f) => !f.matcher.startsWith("judge"));
}

function emitScenarioVerdict(options: {
	passed: boolean;
	index?: number;
	total?: number;
	name: string;
	durationMs: number;
	judgeVerdicts?: JudgeVerdictResult[];
	failures: AssertionFailure[];
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
		}),
	);
}

export async function runSuite(
	options: RunSuiteOptions,
): Promise<SuiteRunReport> {
	const suite = await loadSuiteFile(options.suitePath);
	const defaultHost = options.host ?? suite.defaults?.host ?? "replay";
	const results: ScenarioResult[] = [];
	const scenarios = options.scenarioFilter
		? suite.scenarios.filter(
				(scenario) => scenario.name === options.scenarioFilter,
			)
		: suite.scenarios;

	if (options.scenarioFilter && scenarios.length === 0) {
		throw new Error(`Scenario not found: ${options.scenarioFilter}`);
	}

	const filteredTotal = scenarios.length;
	const parentCounters = parentScenarioCounters();
	const displayTotal = parentCounters?.total ?? filteredTotal;
	const isLiveSuite = defaultHost !== "replay";
	const isolateLive =
		isLiveSuite &&
		liveScenarioIsolationEnabled() &&
		!options.scenarioFilter &&
		filteredTotal > 1;

	if (shouldPrintSuiteChrome()) {
		logProgress(
			`\n${theme.suiteHeader(suite.name, defaultHost, displayTotal)}`,
		);
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
			});
			const durationMs = Math.round(performance.now() - started);
			const failures: AssertionFailure[] = [];
			let judgeVerdicts: JudgeVerdictResult[] | undefined;

			if (exitCode !== 0) {
				const childResult =
					options.stagingSessionId !== undefined
						? await loadStagingResult(
								getStagingResultPath(
									options.stagingSessionId,
									suite.name,
									scenario.name,
								),
							)
						: undefined;
				failures.push(
					...failuresForLiveSubprocessExit(exitCode, childResult),
				);
			}
			if (failures.length === 0 && options.judge !== false && options.stagingSessionId) {
				const criteria = normalizeJudgeCriteria(scenario.rubric.judge);
				if (criteria.length > 0) {
					releaseLiveMemory();
					logPhase(theme.judgePhase(criteria.length), { last: true });
					try {
						const tracePath = getStagingTracePath(
							options.stagingSessionId,
							suite.name,
							scenario.name,
						);
						const trace = await loadStagingTrace(tracePath);
						const judged = await runJudgeRubric(
							trace,
							scenario.rubric,
							options.cwd,
						);
						failures.push(...judged.failures);
						judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria);
					} catch (error) {
						failures.push({
							matcher: "judge",
							message:
								error instanceof Error
									? error.message
									: "failed to load staging trace for judge",
						});
					}
				}
			}

			const passed = failures.length === 0;
			emitScenarioVerdict({
				passed,
				index: index + 1,
				total: filteredTotal,
				name: scenario.name,
				durationMs,
				judgeVerdicts,
				failures,
			});
			results.push({
				suite: suite.name,
				scenario: scenario.name,
				passed,
				failures,
				durationMs,
				judgeVerdicts,
			});
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
): Promise<ScenarioResult> {
	const started = performance.now();

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
	const profile =
		scenario.profile ??
		defaultProfile ??
		(host === "cursor" ? "cursor" : "shared");
	const skills = scenario.skills ?? defaultSkills;
	const isLive = host !== "replay";
	const liveTimeoutMs = isLive ? resolveLiveTimeoutMs(timeoutMs) : undefined;
	const failOnUserInput = !allowUserInput;

	if (scenarioIndex !== undefined && scenarioTotal !== undefined) {
		logProgress(
			theme.scenarioTitle(scenarioIndex, scenarioTotal, scenario.name, host),
		);
	} else {
		logProgress(theme.scenarioLabel(scenario.name, host));
	}

	const useWorktree =
		isLive && worktree !== false && !process.env.AGENT_TEST_NO_WORKTREE;
	let worktreeHandle:
		| Awaited<ReturnType<typeof createScenarioWorktree>>
		| undefined;
	let callerHeadBefore:
		| Awaited<ReturnType<typeof captureCallerHead>>
		| undefined;
	const callerTreeBefore = useWorktree
		? await captureWorkingTreeStatus(cwd)
		: undefined;
	if (useWorktree) {
		if (isLive && scenario.seedPatch) {
			callerHeadBefore = await captureCallerHead(cwd);
			setCallerHeadRestore(cwd, callerHeadBefore);
		}
		worktreeHandle = await createScenarioWorktree(
			cwd,
			`${suiteName}-${scenario.name}`,
		);
		activeWorktreeCleanup = worktreeHandle.cleanup;
		logPhase(theme.phase("worktree", theme.path(worktreeHandle.path)));
		if (isLive && scenario.seedPatch) {
			logPhase(theme.phase("seed", theme.basename(scenario.seedPatch)));
			await seedScenarioWorktree(cwd, worktreeHandle.path, scenario.seedPatch);
		}
	} else if (isLive) {
		logPhase(
			theme.phase(
				"worktree",
				theme.phaseDim("disabled (AGENT_TEST_ALLOW_IN_PLACE=1)"),
			),
		);
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
			logPhase(
				theme.phase("replay", theme.path(scenario.replayTrace ?? "trace")),
			);
		} else {
			logPhase(theme.phase("agent"));
		}

		const outputContract = isLive
			? outputContractForRubric(scenario.rubric)
			: undefined;
		const agentStartMarkerPath =
			isChildProcess() && isLive && stagingSessionId
				? getStagingAgentStartPath(
						stagingSessionId,
						suiteName,
						scenario.name,
					)
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
			failures.push({
				matcher: "runAgent",
				message: session.error ?? `agent session ${session.status}`,
			});
		} else if (
			isLive &&
			failOnUserInput &&
			traceHasUserInputTool(trace.toolCalls)
		) {
			failures.push({
				matcher: "runAgent",
				message:
					"agent trace contains AskQuestion-style user-input tool in headless mode",
			});
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
				failures.push({
					matcher: "workingTreeLeak",
					message: `live agent mutated caller working tree (use worktree isolation):\n${formatWorkingTreeLeak(leaked)}`,
				});
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
					failures.push({
						matcher: "recordTrace",
						message:
							error instanceof Error ? error.message : "failed to record trace",
					});
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
			judgeVerdicts = toJudgeVerdictResults(judged.trace, criteria);
		}

		const durationMs = Math.round(performance.now() - started);

		if (isChildProcess() && isLive && stagingSessionId) {
			await writeStagingResult(
				getStagingResultPath(stagingSessionId, suiteName, scenario.name),
				{
					passed: failures.length === 0,
					failures,
					durationMs,
				},
			);
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

		emitScenarioVerdict({
			passed: failures.length === 0,
			index: scenarioIndex,
			total: scenarioTotal,
			name: scenario.name,
			durationMs,
			judgeVerdicts,
			failures,
		});

		return {
			suite: suiteName,
			scenario: scenario.name,
			passed: failures.length === 0,
			failures,
			durationMs,
			judgeVerdicts,
		};
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
): Promise<{ trace: AgentTrace; failures: AssertionFailure[] }> {
	const criteria = normalizeJudgeCriteria(rubric.judge);
	if (criteria.length === 0) {
		return { trace, failures: [] };
	}

	const result = await judgeTrace(trace, criteria, { cwd: runCwd });
	if (result.skipped) {
		return {
			trace,
			failures: [
				{ matcher: "judge", message: result.error ?? "judge skipped" },
			],
		};
	}

	const judgedTrace: AgentTrace = { ...trace, judgeVerdicts: result.verdicts };
	const failures: AssertionFailure[] = [];
	for (const verdict of result.verdicts) {
		if (!verdict.pass) {
			failures.push({
				matcher: `judge:${verdict.id}`,
				message: verdict.rationale,
			});
		}
	}
	if (result.error) {
		failures.push({ matcher: "judge", message: result.error });
	}
	return { trace: judgedTrace, failures };
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
}): Promise<SuiteRunReport[]> {
	const suitePaths = await discoverSuites(
		resolve(options.cwd, options.suitesDir),
	);
	const filtered = options.filter
		? suitePaths.filter((suitePath) => {
				const suiteName = suiteNameFromPath(suitePath);
				return (
					suiteName === options.filter ||
					suitePath.includes(`/${options.filter}/`)
				);
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
			}),
		);
	}
	return reports;
}

export { discoverSuites } from "./discover-suites.js";
