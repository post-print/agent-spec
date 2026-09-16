import { type AgentHost, sumUsageParts } from "@post-print/agent-harness";

import { finalizeCompareOutcome } from "../compare-scenario.js";
import { buildScenarioStory } from "../scenario-story.js";
import { buildScenarioResultUsage } from "../scenario-usage.js";
import type { ScenarioResult, SuiteRunReport } from "../types.js";
import { DEFAULT_VIEWER_WORKERS, runWorkerPool } from "../worker-pool.js";
import {
	expandViewerJobs,
	type ViewerCatalog,
	type ViewerCatalogScenario,
	type ViewerJob,
	type ViewerRunRequest,
} from "./catalog.js";
import type { ViewerEvent, ViewerRunRecord } from "./events.js";

export const VIEWER_MAX_PARALLEL_AGENTS = DEFAULT_VIEWER_WORKERS;

export interface ViewerRunner {
	runJob(job: ViewerJob, emit: (event: ViewerEvent) => void, signal: AbortSignal): Promise<void>;
	finalizeScenario?(
		input: {
			suite: string;
			scenario: ViewerCatalogScenario;
			host: AgentHost;
			result: ScenarioResult;
		},
		emit: (event: ViewerEvent) => void,
	): Promise<ScenarioResult>;
	finalizeCompare?(input: {
		suite: string;
		scenario: ViewerCatalogScenario;
		host: AgentHost;
		armResults: Map<string, ScenarioResult>;
	}): Promise<ScenarioResult>;
}

export interface ViewerRunHandle {
	runId: string;
}

interface ViewerRunSession {
	record: ViewerRunRecord;
	events: ViewerEvent[];
	listeners: Set<(event: ViewerEvent) => void>;
	abort?: AbortController;
	done: Promise<void>;
	armResults: Map<
		string,
		{ suite: string; scenario: string; host: AgentHost; results: Map<string, ScenarioResult> }
	>;
}

export interface ViewerRunController {
	start(request: ViewerRunRequest): ViewerRunHandle;
	maxParallelAgents(): number;
	cancel(runId: string): boolean;
	history(runId: string): ViewerEvent[] | undefined;
	subscribe(runId: string, listener: (event: ViewerEvent) => void): () => void;
	activeRunId(): string | undefined;
	runs(): ViewerRunRecord[];
	run(runId: string): ViewerRunRecord | undefined;
}

export function followViewerRun(
	controller: ViewerRunController,
	runId: string,
	onEvent: (event: ViewerEvent) => void,
): (() => void) | undefined {
	if (!controller.history(runId)) return undefined;
	let index = 0;
	const flush = (): void => {
		const history = controller.history(runId);
		if (!history) return;
		while (index < history.length) onEvent(history[index++] as ViewerEvent);
	};
	const unsubscribe = controller.subscribe(runId, flush);
	flush();
	return unsubscribe;
}

export function createViewerRunController(options: {
	catalog: ViewerCatalog;
	runner: ViewerRunner;
	maxParallelAgents?: number;
	initialRuns?: ViewerRunRecord[];
}): ViewerRunController {
	const maxParallel = options.maxParallelAgents ?? VIEWER_MAX_PARALLEL_AGENTS;
	const sessions = new Map<string, ViewerRunSession>();
	let activeId: string | undefined;

	for (const record of options.initialRuns ?? []) {
		sessions.set(record.id, {
			record: structuredClone(record),
			events: [],
			listeners: new Set(),
			done: Promise.resolve(),
			armResults: new Map(),
		});
	}

	const emit = (target: ViewerRunSession, event: ViewerEvent): void => {
		target.events.push(event);
		if (event.type === "scenario_result") {
			addScenarioResult(target, event, options.catalog, Boolean(options.runner.finalizeCompare));
		}
		for (const listener of target.listeners) listener(event);
	};

	return {
		activeRunId: () => activeId,
		maxParallelAgents: () => maxParallel,
		runs: () => [...sessions.values()].map(({ record }) => structuredClone(record)),
		run: (runId) => {
			const record = sessions.get(runId)?.record;
			return record ? structuredClone(record) : undefined;
		},
		start(request) {
			if (activeId) throw new Error("A viewer run is already in progress");
			if (
				request.workers !== undefined &&
				(!Number.isInteger(request.workers) || request.workers < 1 || request.workers > maxParallel)
			) {
				throw new Error(`workers must be an integer 1-${maxParallel}`);
			}
			const jobs = expandViewerJobs(options.catalog, request);
			if (jobs.length === 0) throw new Error("No matching scenarios to run");
			const runId = `run-${Date.now()}`;
			const abort = new AbortController();
			const current: ViewerRunSession = {
				record: {
					id: runId,
					request: structuredClone(request),
					status: "running",
					startedAt: new Date().toISOString(),
					reports: [],
				},
				events: [],
				listeners: new Set(),
				abort,
				done: Promise.resolve(),
				armResults: new Map(),
			};
			sessions.set(runId, current);
			activeId = runId;
			emit(current, { type: "run_started", runId });
			current.done = runJobBatches({
				jobs,
				catalog: options.catalog,
				hosts: request.hosts ?? options.catalog.defaultSelectedHosts,
				parallelHosts: request.parallelHosts === true,
				maxParallel: request.workers ?? maxParallel,
				signal: abort.signal,
				runner: options.runner,
				forward: (event) => emit(current, event),
			})
				.then(() => finalizeScheduledCompares(current, options.catalog, options.runner, emit))
				.catch((error) =>
					emit(current, {
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					}),
				)
				.finally(() => {
					const totals = summarizeRun(current.record.reports, current.events);
					current.record.status = abort.signal.aborted ? "cancelled" : "completed";
					current.record.finishedAt = new Date().toISOString();
					emit(current, { type: "run_finished", runId, ...totals });
					if (activeId === runId) activeId = undefined;
				});
			return { runId };
		},
		cancel(runId) {
			const target = sessions.get(runId);
			if (!target?.abort || target.record.status !== "running") return false;
			target.record.status = "cancelling";
			target.abort.abort();
			return true;
		},
		history(runId) {
			const target = sessions.get(runId);
			return target ? [...target.events] : undefined;
		},
		subscribe(runId, listener) {
			const target = sessions.get(runId);
			if (!target) return () => undefined;
			target.listeners.add(listener);
			return () => {
				target.listeners.delete(listener);
			};
		},
	};
}

function addScenarioResult(
	session: ViewerRunSession,
	event: Extract<ViewerEvent, { type: "scenario_result" }>,
	catalog: ViewerCatalog,
	deferCompare: boolean,
): void {
	const report = ensureReport(session.record, event.suite, event.host as AgentHost);
	const scenario = catalog.suites
		.find((suite) => suite.name === event.suite)
		?.scenarios.find((item) => item.name === event.scenario);
	if (!event.arm || !scenario?.compare?.length) {
		upsertReportResult(report, event.result);
		return;
	}
	const key = `${event.suite}::${event.scenario}::${event.host}`;
	const group = session.armResults.get(key) ?? {
		suite: event.suite,
		scenario: event.scenario,
		host: event.host as AgentHost,
		results: new Map<string, ScenarioResult>(),
	};
	group.results.set(event.arm, event.result);
	session.armResults.set(key, group);
	if (group.results.size < scenario.compare.length || deferCompare) return;
	upsertReportResult(
		report,
		buildViewerCompareResult(event.suite, event.scenario, scenario, group.results),
	);
}

function buildViewerCompareResult(
	suite: string,
	scenarioName: string,
	scenario: ViewerCatalogScenario,
	stored: Map<string, ScenarioResult>,
): ScenarioResult {
	const arms = (scenario.compare ?? []).flatMap((arm) => {
		const result = stored.get(arm.id);
		return result
			? [
					{
						id: arm.id,
						label: arm.label,
						description: arm.description,
						prompt: arm.prompt ?? scenario.prompt,
						trace: result.trace,
						durationMs: result.durationMs,
						passed: !result.failures.some((failure) => failure.category === "rubric_miss"),
						failures: result.failures,
						judgeVerdicts: result.judgeVerdicts,
					},
				]
			: [];
	});
	const { compare, failures } = finalizeCompareOutcome(arms, scenario.gates);
	const passed = failures.length === 0;
	const result: ScenarioResult = {
		suite,
		scenario: scenarioName,
		description: scenario.description,
		prompt: scenario.prompt,
		passed,
		failures,
		durationMs: Math.max(...arms.map((arm) => arm.durationMs ?? 0)),
		compare,
		story: buildScenarioStory({
			rubric: scenario.rubric,
			trace: arms[0]?.trace,
			passed,
			failures,
			compare: {
				arms: arms.map((arm) => ({
					id: arm.id,
					label: arm.label,
					description: arm.description,
					prompt: arm.prompt,
					trace: arm.trace,
					passed: arm.passed,
					failures: arm.failures,
					judgeVerdicts: arm.judgeVerdicts,
				})),
				gates: scenario.gates,
			},
		}),
		...buildScenarioResultUsage({
			agentUsage: sumUsageParts(arms.map((arm) => arm.trace?.usage)),
		}),
	};
	return result;
}

async function finalizeScheduledCompares(
	session: ViewerRunSession,
	catalog: ViewerCatalog,
	runner: ViewerRunner,
	emit: (session: ViewerRunSession, event: ViewerEvent) => void,
): Promise<void> {
	if (!runner.finalizeCompare) return;
	for (const group of session.armResults.values()) {
		const scenario = catalog.suites
			.find((suite) => suite.name === group.suite)
			?.scenarios.find((item) => item.name === group.scenario);
		if (!scenario?.compare?.length || group.results.size < scenario.compare.length) continue;
		let result: ScenarioResult;
		try {
			result = await runner.finalizeCompare({
				suite: group.suite,
				scenario,
				host: group.host,
				armResults: group.results,
			});
		} catch (error) {
			result = buildViewerCompareResult(group.suite, group.scenario, scenario, group.results);
			result.failures.push({
				matcher: "compareFinalize",
				message: error instanceof Error ? error.message : String(error),
				category: "agent_runtime",
			});
			result.passed = false;
		}
		emit(session, {
			type: "scenario_result",
			suite: group.suite,
			scenario: group.scenario,
			host: group.host,
			result,
		});
	}
}

function ensureReport(record: ViewerRunRecord, suite: string, host: AgentHost): SuiteRunReport {
	let report = record.reports.find((item) => item.suite === suite && item.host === host);
	if (!report) {
		report = { suite, host, passed: 0, failed: 0, skipped: 0, results: [] };
		record.reports.push(report);
	}
	return report;
}

function upsertReportResult(report: SuiteRunReport, result: ScenarioResult): void {
	const index = report.results.findIndex((item) => item.scenario === result.scenario);
	if (index < 0) report.results.push(structuredClone(result));
	else report.results[index] = structuredClone(result);
	report.passed = report.results.filter((item) => item.passed && !item.skipped).length;
	report.failed = report.results.filter((item) => !item.passed && !item.skipped).length;
	report.skipped = report.results.filter((item) => item.skipped).length;
}

function summarizeReports(reports: SuiteRunReport[]): {
	passed: number;
	failed: number;
	skipped: number;
} {
	return reports.reduce(
		(total, report) => ({
			passed: total.passed + report.passed,
			failed: total.failed + report.failed,
			skipped: total.skipped + report.skipped,
		}),
		{ passed: 0, failed: 0, skipped: 0 },
	);
}

function summarizeRun(
	reports: SuiteRunReport[],
	events: ViewerEvent[],
): { passed: number; failed: number; skipped: number } {
	if (reports.some((report) => report.results.length > 0)) return summarizeReports(reports);
	return events.reduce(
		(total, event) => {
			if (event.type !== "cell_finished") return total;
			if (event.skipped) total.skipped += 1;
			else if (event.passed) total.passed += 1;
			else total.failed += 1;
			return total;
		},
		{ passed: 0, failed: 0, skipped: 0 },
	);
}

async function runJobBatches(options: {
	jobs: ViewerJob[];
	hosts: AgentHost[];
	parallelHosts: boolean;
	maxParallel: number;
	signal: AbortSignal;
	runner: ViewerRunner;
	catalog: ViewerCatalog;
	forward: (event: ViewerEvent) => void;
}): Promise<void> {
	const batches = options.parallelHosts
		? [options.jobs]
		: options.hosts
				.map((host) => options.jobs.filter((job) => job.host === host))
				.filter((batch) => batch.length > 0);
	for (const batch of batches) {
		if (options.signal.aborted) return;
		await runWorkerPool(
			batch,
			options.maxParallel,
			async (job) => {
				try {
					let completedResult: ScenarioResult | undefined;
					await options.runner.runJob(
						job,
						(event) => {
							if (event.type === "scenario_result" && !job.arm) {
								completedResult = event.result;
								return;
							}
							options.forward(event);
						},
						options.signal,
					);
					if (
						!completedResult ||
						job.arm ||
						!options.runner.finalizeScenario ||
						options.signal.aborted
					) {
						if (completedResult)
							options.forward({ type: "scenario_result", ...job, result: completedResult });
						return;
					}
					const scenario = options.catalog.suites
						.find((suite) => suite.name === job.suite)
						?.scenarios.find((item) => item.name === job.scenario);
					if (!scenario || scenario.compare?.length) {
						options.forward({ type: "scenario_result", ...job, result: completedResult });
						return;
					}
					const finalized = await options.runner.finalizeScenario(
						{ suite: job.suite, scenario, host: job.host, result: completedResult },
						options.forward,
					);
					options.forward({ type: "scenario_result", ...job, result: finalized });
				} catch (error) {
					if (options.signal.aborted) return;
					const message = error instanceof Error ? error.message : String(error);
					const envelope = {
						suite: job.suite,
						scenario: job.scenario,
						host: job.host,
						...(job.arm ? { arm: job.arm } : {}),
					};
					const failures = [
						{ matcher: "liveScenario", message, category: "agent_runtime" as const },
					];
					options.forward({ type: "error", ...envelope, message });
					options.forward({
						type: "cell_finished",
						...envelope,
						passed: false,
						failures,
						durationMs: 0,
					});
					options.forward({
						type: "scenario_result",
						...envelope,
						result: {
							suite: job.suite,
							scenario: job.scenario,
							prompt: job.prompt,
							passed: false,
							failures,
							durationMs: 0,
						},
					});
				}
			},
			options.signal,
		);
	}
}
