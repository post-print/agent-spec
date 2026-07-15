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
} from "@post-print/agent-harness";

import { discoverSuites } from "./discover-suites.js";
import { assertRubric } from "./expect.js";
import {
	liveScenarioIsolationEnabled,
	spawnLiveScenario,
	subprocessFailureMessage,
} from "./live-isolation.js";
import { loadSuiteFile } from "./load-suite.js";
import { formatDuration, logPhase, logProgress, withHeartbeat } from "./progress.js";
import {
	getStagingTracePath,
	loadStagingTrace,
	recordTrace,
	resolveRecordingPath,
} from "./record-trace.js";
import { seedScenarioWorktree } from "./scenario-seed.js";
import type {
	AgentScenario,
	AssertionFailure,
	JudgeRubricItem,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";

let activeWorktreeCleanup: (() => Promise<void>) | undefined;
let liveSignalHandlersRegistered = false;

/** Best-effort worktree cleanup when live runs are interrupted (SIGINT/SIGTERM). */
export function registerLiveRunHandlers(): void {
	if (liveSignalHandlersRegistered) {
		return;
	}
	liveSignalHandlersRegistered = true;

	const interrupt = (code: number) => {
		const cleanup = activeWorktreeCleanup;
		if (!cleanup) {
			process.exit(code);
			return;
		}
		void cleanup()
			.catch(() => undefined)
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
}

/** Live-only mode hint from rubric — not part of the user scenario prompt. */
function outputContractForRubric(rubric: ScenarioRubric): RoutingContract | undefined {
	if (rubric.routingBlock) {
		return "hands-off";
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

	const total = scenarios.length;
	const isLiveSuite = defaultHost !== "replay";
	const isolateLive =
		isLiveSuite && liveScenarioIsolationEnabled() && !options.scenarioFilter && total > 1;

	logProgress(`\n${suite.name} (${defaultHost}) — ${total} scenario(s)`);
	if (isolateLive && total > 1) {
		logPhase("live isolation: one subprocess per scenario (AGENT_TEST_NO_ISOLATE=1 to disable)");
	}

	for (let index = 0; index < scenarios.length; index++) {
		const scenario = scenarios[index];
		if (!scenario) {
			continue;
		}

		if (isolateLive) {
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
			});
			const durationMs = Math.round(performance.now() - started);
			const failures: AssertionFailure[] = [];

			if (exitCode !== 0) {
				failures.push({
					matcher: "liveScenario",
					message: subprocessFailureMessage(exitCode),
				});
			} else if (options.judge !== false && options.stagingSessionId) {
				const criteria = normalizeJudgeCriteria(scenario.rubric.judge);
				if (criteria.length > 0) {
					releaseLiveMemory();
					logPhase(`LLM judge (${criteria.length} criterion/criteria)…`);
					try {
						const tracePath = getStagingTracePath(
							options.stagingSessionId,
							suite.name,
							scenario.name,
						);
						const trace = await loadStagingTrace(tracePath);
						const judged = await runJudgeRubric(trace, scenario.rubric, options.cwd);
						failures.push(...judged.failures);
					} catch (error) {
						failures.push({
							matcher: "judge",
							message:
								error instanceof Error ? error.message : "failed to load staging trace for judge",
						});
					}
				}
			}

			const passed = failures.length === 0;
			const icon = passed ? "✓" : "✗";
			logProgress(
				`${icon} [${index + 1}/${total}] ${scenario.name} (${formatDuration(durationMs)})`,
			);
			results.push({
				suite: suite.name,
				scenario: scenario.name,
				passed,
				failures,
				durationMs,
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
				index + 1,
				total,
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
): Promise<ScenarioResult> {
	const started = performance.now();
	const label =
		scenarioIndex !== undefined && scenarioTotal !== undefined
			? `[${scenarioIndex}/${scenarioTotal}] ${scenario.name}`
			: scenario.name;

	if (scenario.skip) {
		logProgress(`${label} — skipped`);
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
	logProgress(`${label} — ${host}`);

	const useWorktree = isLive && worktree !== false && !process.env.AGENT_TEST_NO_WORKTREE;
	let worktreeHandle: Awaited<ReturnType<typeof createScenarioWorktree>> | undefined;
	const callerTreeBefore = useWorktree ? await captureWorkingTreeStatus(cwd) : undefined;
	if (useWorktree) {
		logPhase("creating git worktree…");
		worktreeHandle = await createScenarioWorktree(cwd, `${suiteName}-${scenario.name}`);
		activeWorktreeCleanup = worktreeHandle.cleanup;
		logPhase(`worktree → ${worktreeHandle.path}`);
		if (isLive && scenario.seedPatch) {
			logPhase(`seeding worktree diff (${scenario.seedPatch})…`);
			await seedScenarioWorktree(cwd, worktreeHandle.path, scenario.seedPatch);
		}
	} else if (isLive) {
		logPhase("worktree disabled — agent may mutate repo cwd (AGENT_TEST_ALLOW_IN_PLACE=1)");
	}
	const runCwd = worktreeHandle?.path ?? cwd;

	try {
		logPhase("loading agent context…");
		// Live worktree runs code in an isolated checkout; load rules/AGENTS from caller cwd
		// so uncommitted .cursor/rules and AGENTS.md edits apply during dogfood.
		const contextRoot = isLive && useWorktree ? cwd : runCwd;
		const context = await loadContext({ cwd: contextRoot, profile, skills });
		const useReplay = host === "replay";
		if (useReplay) {
			logPhase(`replaying ${scenario.replayTrace ?? "trace"}…`);
		} else {
			logPhase("running cursor agent (may take several minutes)…");
		}

		const outputContract = isLive ? outputContractForRubric(scenario.rubric) : undefined;
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
					}),
					{ label: "agent still running", started: agentStarted },
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
				`agent finished (${formatDuration(performance.now() - agentStarted)}) — ${session.status}`,
			);
		}

		let trace = enrichTrace(session.trace);
		const failures: AssertionFailure[] = [];

		if (session.status !== "completed") {
			failures.push({
				matcher: "runAgent",
				message: session.error ?? `agent session ${session.status}`,
			});
		}

		logPhase("scoring rubric…");
		failures.push(...assertRubric(trace, scenario.rubric, { skillsMode: context.skillsMode }));

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
				logPhase("recording trace…");
				try {
					const path = await recordTrace(resolved.path, trace);
					const recordLabel = resolved.kind === "fixture" ? "recorded fixture" : "recorded staging";
					logPhase(`${recordLabel} → ${path}`);
				} catch (error) {
					failures.push({
						matcher: "recordTrace",
						message: error instanceof Error ? error.message : "failed to record trace",
					});
				}
			}
		}

		const deferJudgeToParent = process.env.AGENT_TEST_CHILD === "1";
		if (judge && isLive && !deferJudgeToParent) {
			const criteria = normalizeJudgeCriteria(scenario.rubric.judge);
			if (criteria.length > 0) {
				logPhase(`LLM judge (${criteria.length} criterion/criteria)…`);
			}
			const judged = await runJudgeRubric(trace, scenario.rubric, runCwd);
			failures.push(...judged.failures);
			trace = judged.trace;
		}

		const durationMs = Math.round(performance.now() - started);
		const icon = failures.length === 0 ? "✓" : "✗";
		logProgress(`${icon} ${label} (${formatDuration(durationMs)})`);

		return {
			suite: suiteName,
			scenario: scenario.name,
			passed: failures.length === 0,
			failures,
			durationMs,
		};
	} finally {
		if (worktreeHandle) {
			logPhase("removing worktree…");
		}
		await worktreeHandle?.cleanup();
		if (activeWorktreeCleanup === worktreeHandle?.cleanup) {
			activeWorktreeCleanup = undefined;
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
			failures: [{ matcher: "judge", message: result.error ?? "judge skipped" }],
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
			}),
		);
	}
	return reports;
}

export { discoverSuites } from "./discover-suites.js";
