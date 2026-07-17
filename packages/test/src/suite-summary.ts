import type { AssertionFailure, FailureCategory, ScenarioResult, SuiteRunReport } from "./types.js";

export interface RunSummary {
	infraFailures: number;
	rubricFailures: number;
	agentRuntimeFailures: number;
	worktreeLeaks: number;
	recordingErrors: number;
	judgeParseFailures: number;
	/** Scenarios where the LLM judge used more than one attempt. */
	retriedScenarios: number;
	/** Scenarios where announce-stop scenario retry re-ran the agent. */
	scenarioRetriedScenarios: number;
}

export type FailOnMode = "all" | "behavior" | "infra-only";

const INFRA_CATEGORIES = new Set<FailureCategory>(["judge_infra", "agent_runtime"]);

export function summarizeFailures(failures: AssertionFailure[]): RunSummary {
	const summary: RunSummary = {
		infraFailures: 0,
		rubricFailures: 0,
		agentRuntimeFailures: 0,
		worktreeLeaks: 0,
		recordingErrors: 0,
		judgeParseFailures: 0,
		retriedScenarios: 0,
		scenarioRetriedScenarios: 0,
	};
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
	const combined: RunSummary = {
		infraFailures: 0,
		rubricFailures: 0,
		agentRuntimeFailures: 0,
		worktreeLeaks: 0,
		recordingErrors: 0,
		judgeParseFailures: 0,
		retriedScenarios: 0,
		scenarioRetriedScenarios: 0,
	};
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
	}
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

export function formatRunSummary(summary: RunSummary): string {
	return [
		`summary: rubric=${summary.rubricFailures}`,
		`infra=${summary.infraFailures}`,
		`runtime=${summary.agentRuntimeFailures}`,
		`judge_parse=${summary.judgeParseFailures}`,
		`worktree=${summary.worktreeLeaks}`,
		`recording=${summary.recordingErrors}`,
		`retried=${summary.retriedScenarios}`,
		`scenario_retried=${summary.scenarioRetriedScenarios}`,
	].join(" · ");
}
