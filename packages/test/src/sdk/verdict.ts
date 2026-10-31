/** Ledger messages a test fails with when it did not earn a result. See operation-ledger.ts. */
const NOT_EARNED = /without a completed agent operation|were not awaited and did not complete/;
const INFRASTRUCTURE =
	/AgentInfrastructureError|Agent worker exited|Test timeout of \d+ms exceeded|Agent session cancelled/;
const CONDITIONS_UNKNOWN = /ConditionsUnknownError/;

export type RunVerdict =
	| "passed"
	| "agent_failed"
	| "control_survived"
	| "infra_invalid"
	| "conditions_unknown"
	| "vacuous"
	| "flaky"
	| "skipped_only"
	| "interrupted"
	| "listed"
	| "instrument_error";

export interface VerdictAttempt {
	testId?: string;
	retry: number;
	status: "running" | "passed" | "failed" | "skipped" | "interrupted";
	expectedFailure?: boolean;
	/** A control that must fail passed, so its test cannot tell good from bad. */
	survivedControl?: boolean;
	errors: unknown[];
	operations: { data: unknown[] }[];
}
export interface VerdictInput {
	attempts: VerdictAttempt[];
	interrupted: boolean;
	listOnly: boolean;
	/** The test runner's own exit code, checked against what the attempts show. */
	runnerExitCode: number;
}
export interface VerdictResult {
	verdict: RunVerdict;
	exitCode: number;
	tests: Record<string, RunVerdict>;
	counts: { passed: number; total: number };
}

const EXIT_CODES: Record<RunVerdict, number> = {
	passed: 0,
	// Listing tests is not a test run, so nothing failed.
	listed: 0,
	agent_failed: 1,
	control_survived: 1,
	infra_invalid: 2,
	conditions_unknown: 2,
	vacuous: 2,
	flaky: 2,
	skipped_only: 2,
	interrupted: 2,
	instrument_error: 2,
};

function errorText(attempt: VerdictAttempt): string {
	return attempt.errors
		.map((error) => (error as { message?: string } | null)?.message ?? "")
		.join("\n");
}
function operationReportedInfrastructure(attempt: VerdictAttempt): boolean {
	return attempt.operations.some(({ data }) =>
		data.some((item) => (item as { kind?: string } | null)?.kind === "infrastructure"),
	);
}
function failedAttemptVerdict(attempt: VerdictAttempt): RunVerdict {
	const text = errorText(attempt);
	if (CONDITIONS_UNKNOWN.test(text)) return "conditions_unknown";
	if (NOT_EARNED.test(text)) return "vacuous";
	if (INFRASTRUCTURE.test(text) || operationReportedInfrastructure(attempt)) return "infra_invalid";
	return "agent_failed";
}
/** An expected failure only counts when a check failed, not when the host or runner did. */
function passedAttempt(attempt: VerdictAttempt): boolean {
	if (attempt.status === "passed") return true;
	return (
		attempt.status === "failed" &&
		attempt.expectedFailure === true &&
		failedAttemptVerdict(attempt) === "agent_failed"
	);
}
/** One test across all its retries. A pass after a failure stays visible as flaky. */
function testVerdict(attempts: VerdictAttempt[]): RunVerdict {
	const last = attempts.reduce((latest, attempt) =>
		attempt.retry >= latest.retry ? attempt : latest,
	);
	if (last.status === "skipped") return "skipped_only";
	if (last.status === "interrupted" || last.status === "running") return "interrupted";
	if (last.survivedControl) return "control_survived";
	if (!passedAttempt(last)) return failedAttemptVerdict(last);
	return attempts.every(passedAttempt) ? "passed" : "flaky";
}
/** The most serious first: a real agent failure outranks tests that have no verdict. */
const PRECEDENCE: RunVerdict[] = [
	"agent_failed",
	"control_survived",
	"interrupted",
	"infra_invalid",
	"conditions_unknown",
	"vacuous",
	"flaky",
	"passed",
	"skipped_only",
];
function attemptsByTest(attempts: VerdictAttempt[]): Map<string, VerdictAttempt[]> {
	const grouped = new Map<string, VerdictAttempt[]>();
	for (const attempt of attempts) {
		const key = attempt.testId ?? "unknown";
		grouped.set(key, [...(grouped.get(key) ?? []), attempt]);
	}
	return grouped;
}
function runVerdict(input: VerdictInput, tests: Record<string, RunVerdict>): RunVerdict {
	if (input.listOnly) return "listed";
	if (input.interrupted) return "interrupted";
	const present = new Set(Object.values(tests));
	const verdict = PRECEDENCE.find((candidate) => present.has(candidate)) ?? "skipped_only";
	// The attempts and the runner must tell the same story, or neither can be believed.
	if (verdict === "passed" && input.runnerExitCode !== 0) return "instrument_error";
	if (EXIT_CODES[verdict] === 1 && input.runnerExitCode === 0) return "instrument_error";
	return verdict;
}
/** The one place a run's meaning is decided. The CLI exit code and the viewer both read this. */
export function reduceVerdict(input: VerdictInput): VerdictResult {
	const grouped = [...attemptsByTest(input.attempts)];
	const tests = Object.fromEntries(
		grouped.map(([testId, attempts]) => [testId, testVerdict(attempts)]),
	);
	const verdict = runVerdict(input, tests);
	const ran = Object.values(tests).filter((value) => value !== "skipped_only");
	return {
		verdict,
		exitCode: EXIT_CODES[verdict],
		tests,
		counts: {
			passed: ran.filter((value) => value === "passed").length,
			total: ran.length,
		},
	};
}
const SENTENCES: Record<RunVerdict, string> = {
	passed: "Passed",
	agent_failed: "Failed: the agent did not meet a check",
	control_survived:
		"Failed: a control that must fail passed, so its test cannot tell good from bad",
	infra_invalid: "No verdict: the host or runner failed, so nothing is known about the agent",
	conditions_unknown: "No verdict: this run cannot show what a test asked about",
	vacuous: "No verdict: a test finished without earning its result",
	flaky: "No single verdict: a test failed and then passed on retry",
	skipped_only: "No verdict: no test ran",
	interrupted: "No verdict: the run was interrupted",
	listed: "Listed tests only",
	instrument_error: "No verdict: the runner and the recorded attempts disagree",
};
/** Plain words for a person. A count is a count of runs, never a claim of reliability. */
export function verdictSentence({ verdict, counts }: VerdictResult): string {
	if (verdict === "passed")
		return `Passed, ${counts.passed} of ${counts.total} tests, one run each`;
	if (verdict === "listed" || verdict === "skipped_only") return SENTENCES[verdict];
	return `${SENTENCES[verdict]} (${counts.passed} of ${counts.total} tests passed)`;
}
