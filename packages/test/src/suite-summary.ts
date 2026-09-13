import type {
	AssertionFailure,
	FailureCategory,
	RunSummary,
	ScenarioResult,
	SuiteRunReport,
	UsageStats,
} from "./types.js";

function flatUsageFromResult(result: ScenarioResult) {
	return result.usage?.total ?? result.trace?.usage;
}

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
		const usage = flatUsageFromResult(result);
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
		stats.maxTotalTokens = totals[totals.length - 1];
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

function compactNumber(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	return String(value);
}

/** Compact token count for CLI and HTML (`78.2k`). */
export function formatTokenCount(value: number): string {
	return compactNumber(value);
}

function countLabel(count: number, singular: string, plural: string): string {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function formatFailureSummary(summary: RunSummary): string | undefined {
	const parts: string[] = [];
	if (summary.rubricFailures > 0) {
		parts.push(countLabel(summary.rubricFailures, "rubric miss", "rubric misses"));
	}
	if (summary.infraFailures > 0) {
		parts.push(countLabel(summary.infraFailures, "infra failure", "infra failures"));
	}
	if (summary.agentRuntimeFailures > 0) {
		parts.push(countLabel(summary.agentRuntimeFailures, "runtime failure", "runtime failures"));
	}
	if (summary.judgeParseFailures > 0) {
		parts.push(countLabel(summary.judgeParseFailures, "judge parse error", "judge parse errors"));
	}
	if (summary.worktreeLeaks > 0) {
		parts.push(countLabel(summary.worktreeLeaks, "worktree leak", "worktree leaks"));
	}
	if (summary.recordingErrors > 0) {
		parts.push(countLabel(summary.recordingErrors, "recording error", "recording errors"));
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatRetrySummary(summary: RunSummary): string | undefined {
	const parts: string[] = [];
	if (summary.retriedScenarios > 0) {
		parts.push(countLabel(summary.retriedScenarios, "judge retry", "judge retries"));
	}
	if (summary.scenarioRetriedScenarios > 0) {
		parts.push(countLabel(summary.scenarioRetriedScenarios, "scenario retry", "scenario retries"));
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function formatUsageStats(usage: UsageStats): string {
	const parts = [countLabel(usage.scenariosWithUsage, "scenario", "scenarios")];
	if (usage.sumTotalTokens !== undefined) {
		parts.push(`${compactNumber(usage.sumTotalTokens)} tokens`);
	}
	if (usage.scenariosWithUsage > 1 && usage.p50TotalTokens !== undefined) {
		parts.push(`typical ${compactNumber(usage.p50TotalTokens)}`);
	}
	if (usage.scenariosWithUsage > 1 && usage.maxTotalTokens !== undefined) {
		parts.push(`largest ${compactNumber(usage.maxTotalTokens)}`);
	}
	if (usage.sumInputTokens !== undefined) {
		parts.push(`${compactNumber(usage.sumInputTokens)} in`);
	}
	if (usage.sumOutputTokens !== undefined) {
		parts.push(`${compactNumber(usage.sumOutputTokens)} out`);
	}
	return parts.join(" · ");
}

export function formatRunSummary(summary: RunSummary): string {
	const lines: string[] = [];
	const failures = formatFailureSummary(summary);
	if (failures) {
		lines.push(`failures  ${failures}`);
	}
	const retries = formatRetrySummary(summary);
	if (retries) {
		lines.push(`retries   ${retries}`);
	}
	if (summary.usage) {
		lines.push(formatUsageStats(summary.usage));
	}
	return lines.join("\n");
}
