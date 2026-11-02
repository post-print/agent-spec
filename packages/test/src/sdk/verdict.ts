import {
	type BaselineRecord,
	buildClaims,
	type ClaimResult,
	type ClaimSample,
	type SampleAnnotation,
} from "./claims.js";

/**
 * The runner prefixes a thrown error with its class name, so these match how a message starts. A
 * failed check starts with "Error:", so the agent's words quoted further along cannot reach them.
 */
const NOT_EARNED = /^UnearnedResultError\b/;
const INFRASTRUCTURE = /^AgentInfrastructureError\b|^AgentSessionCancelledError\b/;
const CONDITIONS_UNKNOWN = /^ConditionsUnknownError\b/;
const RUNNER_CLEANUP = /^RunnerCleanupError\b/;
const WORKER_CRASH = /^Error: worker process exited unexpectedly \(/;

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
	/** An assertion failed, as opposed to the test throwing for some other reason. */
	checkFailed?: boolean;
	/** The runner stopped the test at its deadline. */
	timedOut?: boolean;
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
	/** Every test the runner set out to run. One that never started leaves the run incomplete. */
	plannedTests?: string[];
	/** The runner reported a failure outside any test, which a failed sample cannot explain. */
	runnerReportedError?: boolean;
	/** Baseline files that could not be read, so a regression could go unseen. */
	unreadableBaselines?: string[];
}
export interface VerdictResult {
	verdict: RunVerdict;
	exitCode: number;
	tests: Record<string, RunVerdict>;
	counts: { passed: number; total: number };
	/** Tests run more than once, reported as rates. */
	claims: ClaimResult[];
	/** What each claim means for the run, by claim. The viewer reads this rather than deciding again. */
	claimVerdicts?: Record<string, RunVerdict>;
	/** Tests the runner set out to run that never started. Absent on older stored runs. */
	notRun?: number;
	unreadableBaselines?: string[];
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

function isCleanupFailure(error: unknown): boolean {
	return RUNNER_CLEANUP.test((error as { message?: string } | null)?.message ?? "");
}
function failedWith(attempt: VerdictAttempt, pattern: RegExp): boolean {
	return attempt.errors.some((error) =>
		pattern.test((error as { message?: string } | null)?.message ?? ""),
	);
}
/** The runner's own report of a dead worker has no stack; a thrown error with these words does. */
function workerCrashed(attempt: VerdictAttempt): boolean {
	return attempt.errors.some((error) => {
		const { message = "", stack } = (error ?? {}) as { message?: string; stack?: string };
		return WORKER_CRASH.test(message) && !stack;
	});
}
function operationReportedInfrastructure(attempt: VerdictAttempt): boolean {
	return attempt.operations.some(({ data }) =>
		data.some((item) => (item as { kind?: string } | null)?.kind === "infrastructure"),
	);
}
function failedAttemptVerdict(attempt: VerdictAttempt): RunVerdict {
	if (failedWith(attempt, CONDITIONS_UNKNOWN)) return "conditions_unknown";
	if (failedWith(attempt, NOT_EARNED)) return "vacuous";
	if (attempt.timedOut || failedWith(attempt, INFRASTRUCTURE)) return "infra_invalid";
	if (workerCrashed(attempt) || operationReportedInfrastructure(attempt)) return "infra_invalid";
	// A control earns its result only on a failed check: a setup error shows nothing about the test.
	if (attempt.expectedFailure && !attempt.checkFailed) return "vacuous";
	// Cleanup alone says nothing about the agent. Any other failure beside it still stands.
	if (attempt.errors.length > 0 && attempt.errors.every(isCleanupFailure)) return "infra_invalid";
	return "agent_failed";
}
/** An expected failure only counts when a check failed, not when the host or runner did. */
function passedAttempt(attempt: VerdictAttempt): boolean {
	if (attempt.survivedControl) return false;
	if (attempt.status === "passed") return true;
	return (
		attempt.status === "failed" &&
		attempt.expectedFailure === true &&
		failedAttemptVerdict(attempt) === "agent_failed"
	);
}
function failedTheAgent(attempt: VerdictAttempt): boolean {
	return (
		attempt.status === "failed" &&
		!passedAttempt(attempt) &&
		failedAttemptVerdict(attempt) === "agent_failed"
	);
}
/** One test across all its retries. A pass after a failure stays visible as flaky. */
function testVerdict(attempts: VerdictAttempt[]): RunVerdict {
	if (attempts.some(({ survivedControl }) => survivedControl)) return "control_survived";
	const last = attempts.reduce((latest, attempt) =>
		attempt.retry >= latest.retry ? attempt : latest,
	);
	if (last.status === "skipped") return "skipped_only";
	if (last.status === "interrupted" || last.status === "running") return "interrupted";
	// A real failure on one try is not undone by the host breaking on the next.
	if (!passedAttempt(last) && attempts.some(failedTheAgent)) return "agent_failed";
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
	// The runner exits 0 on a pass after a retry. The first verdict decides here, so that is no conflict.
	if (input.attempts.some(({ retry }) => retry > 0)) return false;
	return EXIT_CODES[verdict] === 1 && input.runnerExitCode === 0;
}
function runVerdict(present: Set<RunVerdict>, input: VerdictInput, tolerated: boolean): RunVerdict {
	if (input.listOnly) return "listed";
	if (input.interrupted) return "interrupted";
	const verdict = PRECEDENCE.find((candidate) => present.has(candidate)) ?? "skipped_only";
	return runnerDisagrees(verdict, input, tolerated) ? "instrument_error" : verdict;
}
export function sampleOutcome(attempt: VerdictAttempt): ClaimSample["outcome"] {
	if (attempt.status === "skipped") return "not_run";
	if (attempt.survivedControl) return "failed";
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
/**
 * One sample however many times it was retried: its first verdict stands, because trying again
 * until a pass would measure the retries rather than the agent.
 */
function retriedOutcome(attempts: VerdictAttempt[]): ClaimSample["outcome"] {
	const outcomes = [...attempts].sort((a, b) => a.retry - b.retry).map(sampleOutcome);
	const verdict = outcomes.find((outcome) => outcome === "passed" || outcome === "failed");
	return verdict ?? (outcomes.includes("no_verdict") ? "no_verdict" : "not_run");
}
function claimSampleOf(attempts: VerdictAttempt[]): ClaimSample {
	const [first] = attempts;
	return {
		claim: first?.claim ?? "",
		sample: first?.sample,
		outcome: retriedOutcome(attempts),
		survivedControl: attempts.some(({ survivedControl }) => survivedControl),
		record: attempts.map(attemptRecord).find(Boolean),
	};
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
	if (claim.controlsSurvived > 0) return "control_survived";
	if (claim.decision === "flagged") return "agent_failed";
	if (claim.comparisonRefused) return "conditions_unknown";
	if (claim.baseline.status === "same_conditions" && claim.baseline.regressed)
		return "agent_failed";
	if (claim.decision === "no_verdict") return "infra_invalid";
	const repeat = claim.declared || measureRepeats ? undefined : failedRepeatVerdict(claim);
	if (repeat) return repeat;
	return claim.decision === "clear" ? "passed" : "measured";
}
function testsNeverStarted({ attempts, plannedTests = [] }: VerdictInput): number {
	const started = new Set(attempts.map(({ testId }) => testId));
	return plannedTests.filter((testId) => !started.has(testId)).length;
}
function incompleteRunVerdicts(input: VerdictInput, claims: ClaimResult[]): RunVerdict[] {
	const baselinesUnread = claims.length > 0 && Boolean(input.unreadableBaselines?.length);
	return [
		...(testsNeverStarted(input) > 0 ? (["interrupted"] as const) : []),
		...(baselinesUnread ? (["conditions_unknown"] as const) : []),
	];
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
		[...attemptsByTest(samples).values()].map(claimSampleOf),
		input.baselines,
	);
	const claimVerdicts = Object.fromEntries(
		claims.map((claim) => [claim.claim, claimVerdict(claim, input.measureRepeats === true)]),
	);
	const ran = Object.values(tests).filter((value) => value !== "skipped_only");
	const present = new Set([
		...ran,
		...Object.values(tests),
		...Object.values(claimVerdicts),
		...incompleteRunVerdicts(input, claims),
	]);
	// Failed samples make the runner exit non-zero; the claim, not one sample, is the verdict.
	const tolerated =
		!input.runnerReportedError && samples.some((attempt) => attempt.status === "failed");
	const verdict = runVerdict(present, input, tolerated);
	return {
		verdict,
		exitCode: EXIT_CODES[verdict],
		tests,
		claims,
		claimVerdicts,
		counts: { passed: ran.filter((value) => value === "passed").length, total: ran.length },
		notRun: testsNeverStarted(input),
		unreadableBaselines: input.unreadableBaselines ?? [],
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
export function verdictSentence({ verdict, counts, claims }: VerdictResult): string {
	if (verdict === "passed" && claims.length > 0)
		return `Passed, ${counts.passed} of ${counts.total} single-run tests and ${claims.length} sampled tests below`;
	if (verdict === "passed")
		return `Passed, ${counts.passed} of ${counts.total} tests, one run each`;
	if (verdict === "listed" || verdict === "skipped_only" || verdict === "measured")
		return SENTENCES[verdict];
	return `${SENTENCES[verdict]} (${counts.passed} of ${counts.total} tests passed)`;
}
/** What kept the run from being complete, said apart from the verdict it led to. */
export function verdictNotes({ notRun = 0, unreadableBaselines = [] }: VerdictResult): string[] {
	return [
		...(notRun > 0 ? [`${notRun} tests never started`] : []),
		...(unreadableBaselines.length
			? [`Baseline files could not be read: ${unreadableBaselines.join(", ")}`]
			: []),
	];
}
