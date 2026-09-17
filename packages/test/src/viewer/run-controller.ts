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
	finalizing: Set<string>;
	armResults: Map<
		string,
		{
			suite: string;
			scenario: string;
			host: AgentHost;
			results: Map<string, ScenarioResult>;
			judgeWorkspaces: Map<string, { name: string; path: string }>;
		}
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

interface ViewerControllerOptions {
	catalog: ViewerCatalog;
	runner: ViewerRunner;
	maxParallelAgents?: number;
	initialRuns?: ViewerRunRecord[];
}
class RunController implements ViewerRunController {
	private readonly sessions = new Map<string, ViewerRunSession>();
	private activeId: string | undefined;
	private readonly maxParallel: number;
	constructor(private readonly options: ViewerControllerOptions) {
		this.maxParallel = this.options.maxParallelAgents ?? VIEWER_MAX_PARALLEL_AGENTS;
		for (const record of this.options.initialRuns ?? []) {
			this.sessions.set(record.id, {
				record: structuredClone(record),
				events: [],
				listeners: new Set(),
				done: Promise.resolve(),
				armResults: new Map(),
				finalizing: new Set(),
			});
		}
	}
	private emit = (target: ViewerRunSession, event: ViewerEvent): void => {
		target.events.push(event);
		if (event.type === "scenario_result") {
			addScenarioResult(target, event, this.options.catalog);
		}
		for (const listener of target.listeners) listener(event);
	};
	activeRunId = () => this.activeId;
	maxParallelAgents = () => this.maxParallel;
	runs = () => [...this.sessions.values()].map(({ record }) => structuredClone(record));
	run = (runId: string) => {
		const record = this.sessions.get(runId)?.record;
		return record ? structuredClone(record) : undefined;
	};
	start(request: ViewerRunRequest) {
		if (this.activeId) throw new Error("A viewer run is already in progress");
		if (
			request.workers !== undefined &&
			(!Number.isInteger(request.workers) ||
				request.workers < 1 ||
				request.workers > this.maxParallel)
		) {
			throw new Error(`workers must be an integer 1-${this.maxParallel}`);
		}
		const jobs = expandViewerJobs(this.options.catalog, request);
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
			finalizing: new Set(),
		};
		this.sessions.set(runId, current);
		this.activeId = runId;
		this.emit(current, { type: "run_started", runId });
		this.schedule(current, jobs, abort);
		return { runId };
	}
	private schedule(current: ViewerRunSession, jobs: ViewerJob[], abort: AbortController): void {
		const runId = current.record.id;
		const request = current.record.request;
		current.done = runJobBatches({
			jobs,
			catalog: this.options.catalog,
			hosts: request.hosts ?? this.options.catalog.defaultSelectedHosts,
			parallelHosts: request.parallelHosts === true,
			maxParallel: request.workers ?? this.maxParallel,
			signal: abort.signal,
			runner: this.options.runner,
			forward: (event) => this.emit(current, event),
			afterJob: () =>
				finalizeScheduledCompares(current, {
					catalog: this.options.catalog,
					runner: this.options.runner,
					emit: this.emit,
				}),
		})
			.catch((error) =>
				this.emit(current, {
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				}),
			)
			.finally(() => {
				const totals = summarizeRun(current.record.reports, current.events);
				current.record.status = abort.signal.aborted ? "cancelled" : "completed";
				current.record.finishedAt = new Date().toISOString();
				this.emit(current, {
					type: "run_finished",
					runId,
					status: current.record.status,
					...totals,
				});
				if (this.activeId === runId) this.activeId = undefined;
			});
	}

	cancel(runId: string) {
		const target = this.sessions.get(runId);
		if (!target?.abort || target.record.status !== "running") return false;
		target.record.status = "cancelling";
		target.abort.abort();
		return true;
	}
	history(runId: string) {
		const target = this.sessions.get(runId);
		return target ? [...target.events] : undefined;
	}
	subscribe(runId: string, listener: (event: ViewerEvent) => void) {
		const target = this.sessions.get(runId);
		if (!target) return () => undefined;
		target.listeners.add(listener);
		return () => {
			target.listeners.delete(listener);
		};
	}
}
export function createViewerRunController(options: ViewerControllerOptions): ViewerRunController {
	return new RunController(options);
}

function addScenarioResult(
	session: ViewerRunSession,
	event: Extract<ViewerEvent, { type: "scenario_result" }>,
	catalog: ViewerCatalog,
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
		judgeWorkspaces: new Map<string, { name: string; path: string }>(),
	};
	const judgeWorkspace = (
		event.result as ScenarioResult & {
			judgeWorkspace?: { name: string; path: string };
		}
	).judgeWorkspace;
	if (judgeWorkspace) group.judgeWorkspaces.set(event.arm, judgeWorkspace);
	group.results.set(event.arm, event.result);
	session.armResults.set(key, group);
}

function viewerCompareArms(scenario: ViewerCatalogScenario, stored: Map<string, ScenarioResult>) {
	return (scenario.compare ?? []).flatMap((arm) => {
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
}
function buildViewerCompareResult(
	suite: string,
	{
		scenarioName,
		scenario,
		stored,
	}: { scenarioName: string; scenario: ViewerCatalogScenario; stored: Map<string, ScenarioResult> },
): ScenarioResult {
	const arms = viewerCompareArms(scenario, stored);
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
	{
		catalog,
		runner,
		emit,
	}: {
		catalog: ViewerCatalog;
		runner: ViewerRunner;
		emit: (session: ViewerRunSession, event: ViewerEvent) => void;
	},
): Promise<void> {
	for (const [key, group] of session.armResults) {
		if (session.abort?.signal.aborted) return;
		if (session.finalizing.has(key)) continue;
		const scenario = catalog.suites
			.find((suite) => suite.name === group.suite)
			?.scenarios.find((item) => item.name === group.scenario);
		if (!scenario?.compare?.length || group.results.size < scenario.compare.length) continue;
		session.finalizing.add(key);
		await finalizeGroup(session, { group, scenario, runner, emit });
	}
}

type ComparisonGroup = ViewerRunSession["armResults"] extends Map<string, infer G> ? G : never;
type ComparisonFinalization = {
	group: ComparisonGroup;
	scenario: ViewerCatalogScenario;
	runner: ViewerRunner;
	emit: (session: ViewerRunSession, event: ViewerEvent) => void;
};
function comparisonInputs(group: ComparisonGroup): Map<string, ScenarioResult> {
	const armResults = new Map<string, ScenarioResult>();
	for (const [armId, armResult] of group.results) {
		const resultWithWorkspace = structuredClone(armResult);
		const workspace = group.judgeWorkspaces.get(armId);
		if (workspace) {
			Object.defineProperty(resultWithWorkspace, "judgeWorkspace", {
				value: workspace,
				enumerable: false,
			});
		}
		armResults.set(armId, resultWithWorkspace);
	}
	return armResults;
}
function publishComparison(
	session: ViewerRunSession,
	{
		group,
		result,
		emit,
	}: Pick<ComparisonFinalization, "group" | "emit"> & { result: ScenarioResult },
): void {
	emit(session, {
		type: "cell_finished",
		suite: group.suite,
		scenario: group.scenario,
		host: group.host,
		passed: result.passed,
		durationMs: result.durationMs,
		failures: result.failures.map((failure) => ({
			matcher: failure.matcher,
			message: failure.message,
		})),
	});
	emit(session, {
		type: "scenario_result",
		suite: group.suite,
		scenario: group.scenario,
		host: group.host,
		result,
	});
}
async function finalizeGroup(
	session: ViewerRunSession,
	{ group, scenario, runner, emit }: ComparisonFinalization,
): Promise<void> {
	emit(session, {
		type: "cell_started",
		suite: group.suite,
		scenario: group.scenario,
		host: group.host,
	});
	emit(session, {
		type: "scenario_finalizing",
		suite: group.suite,
		scenario: group.scenario,
		host: group.host,
	});
	emit(session, {
		type: "status",
		suite: group.suite,
		scenario: group.scenario,
		host: group.host,
		text: "Finalizing comparison and judge.",
	});
	let result: ScenarioResult;
	try {
		const armResults = comparisonInputs(group);
		result = runner.finalizeCompare
			? await runner.finalizeCompare({
					suite: group.suite,
					scenario,
					host: group.host,
					armResults,
				})
			: buildViewerCompareResult(group.suite, {
					scenarioName: group.scenario,
					scenario: scenario,
					stored: group.results,
				});
	} catch (error) {
		result = buildViewerCompareResult(group.suite, {
			scenarioName: group.scenario,
			scenario: scenario,
			stored: group.results,
		});
		result.failures.push({
			matcher: "compareFinalize",
			message: error instanceof Error ? error.message : String(error),
			category: "agent_runtime",
		});
		result.passed = false;
	}
	if (session.abort?.signal.aborted) return;
	publishComparison(session, { group, result, emit });
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
	if (events.some((event) => event.type === "scenario_result")) return summarizeReports(reports);
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

interface JobBatchOptions {
	jobs: ViewerJob[];
	hosts: AgentHost[];
	parallelHosts: boolean;
	maxParallel: number;
	signal: AbortSignal;
	runner: ViewerRunner;
	catalog: ViewerCatalog;
	forward: (event: ViewerEvent) => void;
	afterJob: () => Promise<void>;
}
async function runJobBatches(options: JobBatchOptions): Promise<void> {
	const batches = options.parallelHosts
		? [options.jobs]
		: options.hosts
				.map((host) => options.jobs.filter((job) => job.host === host))
				.filter((batch) => batch.length > 0);
	for (const batch of batches) {
		if (options.signal.aborted) return;
		await runWorkerPool(batch, {
			workers: options.maxParallel,
			worker: (job) => runViewerJob(job, options),
			signal: options.signal,
		});
	}
}

async function runViewerJob(job: ViewerJob, options: JobBatchOptions): Promise<void> {
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
		await finalizeViewerJob(job, options, completedResult);
	} catch (error) {
		publishJobFailure(job, options, error);
	} finally {
		await options.afterJob();
	}
}

async function finalizeViewerJob(
	job: ViewerJob,
	options: JobBatchOptions,
	completedResult: ScenarioResult | undefined,
): Promise<void> {
	if (!completedResult || job.arm || !options.runner.finalizeScenario || options.signal.aborted) {
		if (completedResult && !options.signal.aborted)
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
	options.forward({ type: "scenario_finalizing", ...job });
	const finalized = await options.runner.finalizeScenario(
		{ suite: job.suite, scenario, host: job.host, result: completedResult },
		options.forward,
	);
	// The child emits an agent-only completion before parent-process judging.
	// Replace that provisional status so the cell cannot remain green when
	// judging later fails or becomes unavailable.
	options.forward({
		type: "cell_finished",
		...job,
		passed: finalized.passed,
		durationMs: finalized.durationMs,
		failures: finalized.failures.map((failure) => ({
			matcher: failure.matcher,
			message: failure.message,
		})),
	});
	options.forward({ type: "scenario_result", ...job, result: finalized });
}

function publishJobFailure(job: ViewerJob, options: JobBatchOptions, error: unknown): void {
	if (options.signal.aborted) return;
	const message = error instanceof Error ? error.message : String(error);
	const envelope = {
		suite: job.suite,
		scenario: job.scenario,
		host: job.host,
		...(job.arm ? { arm: job.arm } : {}),
	};
	const failures = [{ matcher: "liveScenario", message, category: "agent_runtime" as const }];
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
