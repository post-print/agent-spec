import {
	type BaselineRecord,
	buildClaims,
	type ClaimResult,
	type ClaimSample,
	type SampleAnnotation,
} from "./claims.js";

/** Ledger messages a test fails with when it did not earn a result. See operation-ledger.ts. */
const NOT_EARNED = /without a completed agent operation|were not awaited and did not complete/;
const INFRASTRUCTURE =
	/AgentInfrastructureError|Agent worker exited|Test timeout of \d+ms exceeded|Agent session cancelled/;
const CONDITIONS_UNKNOWN = /ConditionsUnknownError/;

export type RunVerdict =
	| "passed"
	| "measured"
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
	/** Project and title path, the identity shared by every run of one test. */
	claim?: string;
	sample?: SampleAnnotation;
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
	baselines?: Record<string, BaselineRecord>;
	/** Report repeats from the command line as rates. Otherwise a failed repeat fails the run. */
	measureRepeats?: boolean;
}
export interface VerdictResult {
	verdict: RunVerdict;
	exitCode: number;
	tests: Record<string, RunVerdict>;
	counts: { passed: number; total: number };
	/** Tests run more than once, reported as rates. */
	claims: ClaimResult[];
}

const EXIT_CODES: Record<RunVerdict, number> = {
	passed: 0,
	// A rate with no threshold to meet: nothing was asked of it, so nothing failed.
	measured: 0,
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
	"measured",
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
/** The attempts and the runner must tell the same story, or neither can be believed. */
function runnerDisagrees(verdict: RunVerdict, input: VerdictInput, tolerated: boolean): boolean {
	if (EXIT_CODES[verdict] === 0 && input.runnerExitCode !== 0) return !tolerated;
	return EXIT_CODES[verdict] === 1 && input.runnerExitCode === 0;
}
function runVerdict(present: Set<RunVerdict>, input: VerdictInput, tolerated: boolean): RunVerdict {
	if (input.listOnly) return "listed";
	if (input.interrupted) return "interrupted";
	const verdict = PRECEDENCE.find((candidate) => present.has(candidate)) ?? "skipped_only";
	return runnerDisagrees(verdict, input, tolerated) ? "instrument_error" : verdict;
}
function sampleOutcome(attempt: VerdictAttempt): ClaimSample["outcome"] {
	if (attempt.status === "skipped") return "not_run";
	if (passedAttempt(attempt)) return "passed";
	if (attempt.status !== "failed") return "no_verdict";
	return failedAttemptVerdict(attempt) === "agent_failed" ? "failed" : "no_verdict";
}
function attemptRecord(attempt: VerdictAttempt): Record<string, unknown> | undefined {
	for (const { data } of attempt.operations)
		for (const item of data) {
			const record = (item as { record?: Record<string, unknown> } | null)?.record;
			if (record) return record;
		}
	return undefined;
}
/** Sampled when declared, or when one title ran as several tests through a repeat. */
function sampledClaims(attempts: VerdictAttempt[]): Set<string> {
	const testIds = new Map<string, Set<string | undefined>>();
	const sampled = new Set<string>();
	for (const { claim, sample, testId } of attempts) {
		if (!claim) continue;
		if (sample) sampled.add(claim);
		testIds.set(claim, (testIds.get(claim) ?? new Set()).add(testId));
		if ((testIds.get(claim)?.size ?? 0) > 1) sampled.add(claim);
	}
	return sampled;
}
function failedRepeatVerdict({ arms }: ClaimResult): RunVerdict | undefined {
	if (arms.some(({ failed }) => failed > 0)) return "agent_failed";
	return arms.some(({ noVerdict }) => noVerdict > 0) ? "infra_invalid" : undefined;
}
/** Asking for repeats is not asking for a rate: a gate using --repeat-each must still go red. */
function claimVerdict(claim: ClaimResult, measureRepeats: boolean): RunVerdict {
	if (claim.comparisonRefused) return "conditions_unknown";
	if (claim.decision === "no_verdict") return "infra_invalid";
	const repeat = claim.declared || measureRepeats ? undefined : failedRepeatVerdict(claim);
	if (repeat) return repeat;
	if (claim.decision === "flagged") return "agent_failed";
	if (claim.baseline.status === "same_conditions" && claim.baseline.regressed)
		return "agent_failed";
	return claim.decision === "clear" ? "passed" : "measured";
}
/** The one place a run's meaning is decided. The CLI exit code and the viewer both read this. */
export function reduceVerdict(input: VerdictInput): VerdictResult {
	const sampled = sampledClaims(input.attempts);
	const isSampled = ({ claim }: VerdictAttempt) => claim !== undefined && sampled.has(claim);
	const samples = input.attempts.filter(isSampled);
	const grouped = [...attemptsByTest(input.attempts.filter((attempt) => !isSampled(attempt)))];
	const tests = Object.fromEntries(
		grouped.map(([testId, attempts]) => [testId, testVerdict(attempts)]),
	);
	const claims = buildClaims(
		samples.map((attempt) => ({
			claim: attempt.claim ?? "",
			sample: attempt.sample,
			outcome: sampleOutcome(attempt),
			record: attemptRecord(attempt),
		})),
		input.baselines,
	);
	const ran = Object.values(tests).filter((value) => value !== "skipped_only");
	const present = new Set([
		...ran,
		...Object.values(tests),
		...claims.map((claim) => claimVerdict(claim, input.measureRepeats === true)),
	]);
	// Failed samples make the runner exit non-zero; the claim, not one sample, is the verdict.
	const tolerated = samples.some((attempt) => attempt.status === "failed");
	const verdict = runVerdict(present, input, tolerated);
	return {
		verdict,
		exitCode: EXIT_CODES[verdict],
		tests,
		claims,
		counts: { passed: ran.filter((value) => value === "passed").length, total: ran.length },
	};
}
const SENTENCES: Record<RunVerdict, string> = {
	passed: "Passed",
	measured: "Measured: rates are reported below, with nothing required of them",
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
	if (verdict === "listed" || verdict === "skipped_only" || verdict === "measured")
		return SENTENCES[verdict];
	return `${SENTENCES[verdict]} (${counts.passed} of ${counts.total} tests passed)`;
}
