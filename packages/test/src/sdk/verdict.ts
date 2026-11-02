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
	| "indicative"
	| "agent_failed"
	| "control_survived"
	| "infra_invalid"
	| "conditions_unknown"
	| "vacuous"
	| "flaky"
	| "skipped_only"
	| "interrupted"
	| "listed"
	| "author_error"
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
	/** For a control that names its check: whether that check is the one that failed. */
	namedCheckFailed?: boolean;
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
	/** The caller accepts an indicative run as exit 0. The result says so. */
	allowIndicative?: boolean;
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
	/** An indicative run exited 0 only because the caller passed --allow-indicative. */
	indicativeAllowed?: boolean;
}

/** The only verdicts that may exit 0. Each must show its evidence in EXIT_ZERO_PATHS. */
type ExitZeroVerdict = "passed" | "listed";
const EXIT_CODES: { [V in RunVerdict]: V extends ExitZeroVerdict ? 0 : 1 | 2 | 3 } = {
	passed: 0,
	// Listing tests is not a test run, so nothing failed.
	listed: 0,
	// Something ran and nothing failed, but the evidence cannot carry a pass.
	indicative: 3,
	agent_failed: 1,
	control_survived: 1,
	infra_invalid: 2,
	conditions_unknown: 2,
	vacuous: 2,
	flaky: 2,
	skipped_only: 2,
	interrupted: 2,
	author_error: 2,
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
function operationReported(attempt: VerdictAttempt, kind: string): boolean {
	return attempt.operations.some(({ data }) =>
		data.some((item) => (item as { kind?: string } | null)?.kind === kind),
	);
}
function operationReportedInfrastructure(attempt: VerdictAttempt): boolean {
	return operationReported(attempt, "infrastructure");
}
/**
 * The agent is charged only on evidence that it caused the failure: a check that failed after it
 * started, or its own outcome as the host reported it. An operation that failed for a reason
 * nobody typed is the instrument's. Anything else came from the test's own code.
 */
function blamedSource(attempt: VerdictAttempt): RunVerdict {
	if (attempt.checkFailed || operationReported(attempt, "agent")) return "agent_failed";
	if (operationReported(attempt, "runtime")) return "instrument_error";
	return "author_error";
}
/** A failure whose cause was typed when it happened, before any check could be blamed. */
function typedFailureVerdict(attempt: VerdictAttempt): RunVerdict | undefined {
	if (failedWith(attempt, CONDITIONS_UNKNOWN)) return "conditions_unknown";
	if (failedWith(attempt, NOT_EARNED)) return "vacuous";
	if (attempt.timedOut || failedWith(attempt, INFRASTRUCTURE)) return "infra_invalid";
	if (workerCrashed(attempt) || operationReportedInfrastructure(attempt)) return "infra_invalid";
	return undefined;
}
function failedAttemptVerdict(attempt: VerdictAttempt): RunVerdict {
	const typed = typedFailureVerdict(attempt);
	if (typed) return typed;
	// A failure with nothing recorded against it: the instrument lost what happened.
	if (attempt.errors.length === 0) return "instrument_error";
	// A control earns its result only on a failed check, and on the one it names when it names one:
	// a setup error or a failed precondition shows nothing about the test.
	if (attempt.expectedFailure && (!attempt.checkFailed || attempt.namedCheckFailed === false))
		return "vacuous";
	// Cleanup alone says nothing about the agent. Any other failure beside it still stands.
	if (attempt.errors.every(isCleanupFailure)) return "infra_invalid";
	return blamedSource(attempt);
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
	"instrument_error",
	"interrupted",
	"author_error",
	"infra_invalid",
	"conditions_unknown",
	"vacuous",
	"flaky",
	"indicative",
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
	const nothingFailed = EXIT_CODES[verdict] === 0 || verdict === "indicative";
	if (nothingFailed && input.runnerExitCode !== 0) return !tolerated;
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
function isRepeatGate(claim: ClaimResult, measureRepeats: boolean): boolean {
	return !claim.declared && !measureRepeats;
}
/** Every repeat ran to a verdict and passed. */
function everyRepeatPassed({ arms }: ClaimResult): boolean {
	return arms.every(
		({ passed, failed, noVerdict }) => passed > 0 && failed === 0 && noVerdict === 0,
	);
}
/** Asking for repeats is not asking for a rate: a gate using --repeat-each must still go red. */
function claimVerdict(claim: ClaimResult, measureRepeats: boolean): RunVerdict {
	if (claim.controlsSurvived > 0) return "control_survived";
	if (claim.planConflict) return "instrument_error";
	if (claim.decision === "flagged") return "agent_failed";
	if (claim.comparisonRefused) return "conditions_unknown";
	if (claim.baseline.status === "same_conditions" && claim.baseline.regressed)
		return "agent_failed";
	if (claim.decision === "no_verdict") return "infra_invalid";
	// Repeats from the command line gate on every repeat, which is a plan: all of them must pass.
	if (isRepeatGate(claim, measureRepeats)) return failedRepeatVerdict(claim) ?? "passed";
	// A rate with no plan: nothing was asked of it, so it shows a rate but cannot pass.
	return claim.decision === "clear" ? "passed" : "indicative";
}
function testsNeverStarted({ attempts, plannedTests = [] }: VerdictInput): number {
	const started = new Set(attempts.map(({ testId }) => testId));
	return plannedTests.filter((testId) => !started.has(testId)).length;
}
function unfinished({ status }: VerdictAttempt): boolean {
	return status === "running" || status === "interrupted";
}
function incompleteRunVerdicts(input: VerdictInput, claims: ClaimResult[]): RunVerdict[] {
	const baselinesUnread = claims.length > 0 && Boolean(input.unreadableBaselines?.length);
	const incomplete = testsNeverStarted(input) > 0 || input.attempts.some(unfinished);
	return [
		...(incomplete ? (["interrupted"] as const) : []),
		...(baselinesUnread ? (["conditions_unknown"] as const) : []),
	];
}
interface ExitZeroEvidence {
	input: VerdictInput;
	tests: Record<string, RunVerdict>;
	claims: ClaimResult[];
	claimVerdicts: Record<string, RunVerdict>;
}
/** A run passes on positive evidence: tests and plans that passed, not only an absence of failures. */
function everythingRanPassed({ input, tests, claims, claimVerdicts }: ExitZeroEvidence): boolean {
	const verdicts = [...Object.values(tests), ...Object.values(claimVerdicts)];
	const cleared = claims.every(
		(claim) =>
			claimVerdicts[claim.claim] !== "passed" ||
			claim.decision === "clear" ||
			(isRepeatGate(claim, input.measureRepeats === true) && everyRepeatPassed(claim)),
	);
	return (
		!input.interrupted &&
		testsNeverStarted(input) === 0 &&
		verdicts.includes("passed") &&
		verdicts.every((verdict) => verdict === "passed" || verdict === "skipped_only") &&
		cleared
	);
}
/**
 * Every way a run may exit 0, each with the evidence it needs. A verdict that reaches exit 0
 * without its evidence is the instrument's error, never a pass.
 */
export const EXIT_ZERO_PATHS: Record<ExitZeroVerdict, (evidence: ExitZeroEvidence) => boolean> = {
	listed: ({ input }) => input.listOnly,
	passed: everythingRanPassed,
};
function isExitZero(verdict: RunVerdict): verdict is ExitZeroVerdict {
	return Object.hasOwn(EXIT_ZERO_PATHS, verdict);
}
function provenVerdict(verdict: RunVerdict, evidence: ExitZeroEvidence): RunVerdict {
	if (isExitZero(verdict) && !EXIT_ZERO_PATHS[verdict](evidence)) return "instrument_error";
	return verdict;
}
function exitCodeOf(verdict: RunVerdict, input: VerdictInput): number {
	return verdict === "indicative" && input.allowIndicative ? 0 : EXIT_CODES[verdict];
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
	const evidence = { input, tests, claims, claimVerdicts };
	const verdict = provenVerdict(runVerdict(present, input, tolerated), evidence);
	return {
		verdict,
		exitCode: exitCodeOf(verdict, input),
		tests,
		claims,
		claimVerdicts,
		counts: { passed: ran.filter((value) => value === "passed").length, total: ran.length },
		notRun: testsNeverStarted(input),
		unreadableBaselines: input.unreadableBaselines ?? [],
		...(verdict === "indicative" && input.allowIndicative ? { indicativeAllowed: true } : {}),
	};
}
const SENTENCES: Record<RunVerdict, string> = {
	passed: "Passed",
	indicative:
		"Indicative: rates are reported below, with no plan to decide them, so nothing passed",
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
	author_error:
		"No verdict: the test's own code failed, not a check on the agent, so nothing is known about the agent",
	instrument_error: "No verdict: the runner and the recorded attempts disagree",
};
/** Plain words for a person. A count is a count of runs, never a claim of reliability. */
export function verdictSentence({ verdict, counts, claims }: VerdictResult): string {
	if (verdict === "passed" && claims.length > 0)
		return `Passed, ${counts.passed} of ${counts.total} single-run tests and ${claims.length} sampled tests below`;
	if (verdict === "passed")
		return `Passed, ${counts.passed} of ${counts.total} tests, one run each`;
	if (verdict === "listed" || verdict === "skipped_only" || verdict === "indicative")
		return SENTENCES[verdict];
	return `${SENTENCES[verdict]} (${counts.passed} of ${counts.total} tests passed)`;
}
/** What kept the run from being complete, said apart from the verdict it led to. */
export function verdictNotes({
	notRun = 0,
	unreadableBaselines = [],
	indicativeAllowed,
}: VerdictResult): string[] {
	return [
		...(indicativeAllowed ? ["Exit 0 only because --allow-indicative was given"] : []),
		...(notRun > 0 ? [`${notRun} tests never started`] : []),
		...(unreadableBaselines.length
			? [`Baseline files could not be read: ${unreadableBaselines.join(", ")}`]
			: []),
	];
}
