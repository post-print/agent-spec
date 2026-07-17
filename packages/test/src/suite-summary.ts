import type {
	AssertionFailure,
	FailureCategory,
	RunSummary,
	ScenarioResult,
	SuiteRunReport,
	UsageStats,
} from "./types.js";

export type { RunSummary, UsageStats } from "./types.js";

export type FailOnMode = "all" | "behavior" | "infra-only";

const INFRA_CATEGORIES = new Set<FailureCategory>(["judge_infra", "agent_runtime"]);

function emptyRunSummary(): RunSummary {
	return {
		infraFailures: 0,
		rubricFailures: 0,
		agentRuntimeFailures: 0,
		worktreeLeaks: 0,
		recordingErrors: 0,
		judgeParseFailures: 0,
		retriedScenarios: 0,
		scenarioRetriedScenarios: 0,
	};
}

/** Nearest-rank percentile (p in 0–100) over a sorted ascending array. */
export function percentileNearestRank(sortedAsc: number[], p: number): number | undefined {
	if (sortedAsc.length === 0) {
		return undefined;
	}
	const clamped = Math.min(100, Math.max(0, p));
	const rank = Math.ceil((clamped / 100) * sortedAsc.length) - 1;
	return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, rank))];
}

export function summarizeUsage(results: ScenarioResult[]): UsageStats | undefined {
	const totals: number[] = [];
	let scenariosWithUsage = 0;
	let sumTotal = 0;
	let sumInput = 0;
	let sumOutput = 0;
	let sawInput = false;
	let sawOutput = false;

	for (const result of results) {
		const usage = result.usage ?? result.trace?.usage;
		if (!usage) {
			continue;
		}
		scenariosWithUsage++;
		const total = usage.totalTokens;
		if (typeof total === "number" && Number.isFinite(total)) {
			totals.push(total);
			sumTotal += total;
		}
		if (typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
			sumInput += usage.inputTokens;
			sawInput = true;
		}
		if (typeof usage.outputTokens === "number" && Number.isFinite(usage.outputTokens)) {
			sumOutput += usage.outputTokens;
			sawOutput = true;
		}
	}

	if (scenariosWithUsage === 0) {
		return undefined;
	}

	totals.sort((a, b) => a - b);
	const stats: UsageStats = { scenariosWithUsage };
	if (totals.length > 0) {
		stats.sumTotalTokens = sumTotal;
		stats.p50TotalTokens = percentileNearestRank(totals, 50);
		stats.p95TotalTokens = percentileNearestRank(totals, 95);
	}
	if (sawInput) {
		stats.sumInputTokens = sumInput;
	}
	if (sawOutput) {
		stats.sumOutputTokens = sumOutput;
	}
	return stats;
}

export function summarizeFailures(failures: AssertionFailure[]): RunSummary {
	const summary = emptyRunSummary();
	for (const failure of failures) {
		switch (failure.category) {
			case "judge_infra":
				summary.infraFailures++;
				break;
			case "judge_parse":
				summary.judgeParseFailures++;
				break;
			case "agent_runtime":
				summary.agentRuntimeFailures++;
				break;
			case "worktree_leak":
				summary.worktreeLeaks++;
				break;
			case "recording_error":
				summary.recordingErrors++;
				break;
			default:
				summary.rubricFailures++;
				break;
		}
	}
	return summary;
}

export function summarizeReports(reports: SuiteRunReport[]): RunSummary {
	const combined = emptyRunSummary();
	const allResults: ScenarioResult[] = [];
	for (const report of reports) {
		const partial = report.summary ?? summarizeReportResults(report.results);
		combined.infraFailures += partial.infraFailures;
		combined.rubricFailures += partial.rubricFailures;
		combined.agentRuntimeFailures += partial.agentRuntimeFailures;
		combined.worktreeLeaks += partial.worktreeLeaks;
		combined.recordingErrors += partial.recordingErrors;
		combined.judgeParseFailures += partial.judgeParseFailures;
		combined.retriedScenarios += partial.retriedScenarios;
		combined.scenarioRetriedScenarios += partial.scenarioRetriedScenarios;
		allResults.push(...report.results);
	}
	combined.usage = summarizeUsage(allResults);
	return combined;
}

export function summarizeReportResults(results: ScenarioResult[]): RunSummary {
	const allFailures = results.flatMap((result) => result.failures);
	const summary = summarizeFailures(allFailures);
	summary.retriedScenarios = results.reduce(
		(count, result) =>
			count + (result.judgeVerdicts?.some((verdict) => (verdict.attempt ?? 1) > 1) ? 1 : 0),
		0,
	);
	summary.scenarioRetriedScenarios = results.reduce(
		(count, result) => count + ((result.attempts ?? 1) > 1 ? 1 : 0),
		0,
	);
	summary.usage = summarizeUsage(results);
	return summary;
}

/** Whether a failed scenario should fail the process under the given fail-on mode. */
export function shouldFailScenario(failures: AssertionFailure[], mode: FailOnMode): boolean {
	if (mode === "infra-only") {
		return failures.some((failure) => INFRA_CATEGORIES.has(failure.category));
	}
	if (mode === "all") {
		return failures.length > 0;
	}
	// behavior: ignore pure infra flakes
	return failures.some((failure) => !INFRA_CATEGORIES.has(failure.category));
}

export function formatUsageStats(usage: UsageStats): string {
	const parts = [`usage_n=${usage.scenariosWithUsage}`];
	if (usage.sumTotalTokens !== undefined) {
		parts.push(`tokens_sum=${usage.sumTotalTokens}`);
	}
	if (usage.p50TotalTokens !== undefined) {
		parts.push(`p50=${usage.p50TotalTokens}`);
	}
	if (usage.p95TotalTokens !== undefined) {
		parts.push(`p95=${usage.p95TotalTokens}`);
	}
	if (usage.sumInputTokens !== undefined) {
		parts.push(`in=${usage.sumInputTokens}`);
	}
	if (usage.sumOutputTokens !== undefined) {
		parts.push(`out=${usage.sumOutputTokens}`);
	}
	return parts.join(" · ");
}

export function formatRunSummary(summary: RunSummary): string {
	const base = [
		`summary: rubric=${summary.rubricFailures}`,
		`infra=${summary.infraFailures}`,
		`runtime=${summary.agentRuntimeFailures}`,
		`judge_parse=${summary.judgeParseFailures}`,
		`worktree=${summary.worktreeLeaks}`,
		`recording=${summary.recordingErrors}`,
		`retried=${summary.retriedScenarios}`,
		`scenario_retried=${summary.scenarioRetriedScenarios}`,
	].join(" · ");
	if (!summary.usage) {
		return base;
	}
	return `${base}\n${formatUsageStats(summary.usage)}`;
}
