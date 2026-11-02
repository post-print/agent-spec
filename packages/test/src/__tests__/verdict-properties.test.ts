import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { attemptRecords, recordWeaknesses } from "../sdk/claim-strength.js";
import {
	reduceVerdict,
	type VerdictAttempt,
	type VerdictInput,
	type VerdictResult,
} from "../sdk/verdict.js";

/**
 * Properties every run must keep, checked over generated attempts rather than chosen cases. Each
 * one is a rule of the north star: exit 0 needs evidence, and the agent is blamed only on its own.
 */
const MESSAGES = [
	"Error: expect(received).toBe(expected)",
	"AgentInfrastructureError: auth",
	"UnearnedResultError: no agent ran",
	"ConditionsUnknownError: no catalog",
	"RunnerCleanupError: rm failed",
	"TypeError: Cannot read properties of undefined",
	"AgentOutcomeError: error_max_turns",
];
const STRONG_RECORD = {
	host: "claude",
	calibrated: true,
	modelPinned: true,
	userConfig: "excluded",
	confinement: "host-enforced",
};
const TYPED = /^(AgentInfrastructureError|UnearnedResultError|ConditionsUnknownError)\b/;
const WORKER_CRASH = { message: "Error: worker process exited unexpectedly (code 1)" };

const error = fc.oneof(
	fc.constantFrom(...MESSAGES).map((message) => ({ message, stack: "at test" })),
	fc.constant(WORKER_CRASH),
);
const operation = fc.record({
	data: fc.array(
		fc.constantFrom(
			{ kind: "infrastructure" },
			{ kind: "agent" },
			{ kind: "runtime" },
			{ kind: "run" },
			{ record: STRONG_RECORD },
			{ record: { ...STRONG_RECORD, calibrated: false } },
			{ record: { ...STRONG_RECORD, userConfig: "may-load" } },
		),
		{ maxLength: 2 },
	),
});
const TESTS = ["a", "b", "c", "d"];
const plan = fc.record(
	{ title: fc.constant("claim"), n: fc.constant(3), flagAt: fc.integer({ min: 1, max: 3 }) },
	{ requiredKeys: ["title", "n"] },
);
/** A sampled test keeps its plan on every attempt; plans may still differ between its samples. */
const plans = fc.tuple(...TESTS.map(() => fc.option(plan, { nil: undefined })));
const attemptFields = fc.record(
	{
		status: fc.constantFrom("passed", "failed", "skipped", "interrupted", "running"),
		expectedFailure: fc.boolean(),
		survivedControl: fc.boolean(),
		checkFailed: fc.boolean(),
		namedCheckFailed: fc.boolean(),
		timedOut: fc.boolean(),
		errors: fc.array(error, { maxLength: 2 }),
		operations: fc.array(operation, { maxLength: 2 }),
	},
	{ requiredKeys: ["status", "errors", "operations"] },
);
const keys = fc.uniqueArray(
	fc.record({ testId: fc.constantFrom(...TESTS), retry: fc.integer({ min: 0, max: 2 }) }),
	{ maxLength: 6, selector: ({ testId, retry }) => `${testId}#${retry}` },
);
/** One attempt per test and retry, as the runner records them. */
const attempts = fc.tuple(keys, plans).chain(([list, plansByTest]) =>
	fc.tuple(
		...list.map((key) =>
			attemptFields.map((fields): VerdictAttempt => {
				const sample = plansByTest[TESTS.indexOf(key.testId)];
				return sample ? { ...key, ...fields, sample, claim: "claim" } : { ...key, ...fields };
			}),
		),
	),
);
const input = fc.record({
	attempts,
	interrupted: fc.boolean(),
	listOnly: fc.boolean(),
	runnerExitCode: fc.constantFrom(0, 1),
	measureRepeats: fc.boolean(),
	plannedTests: fc.subarray(TESTS),
});

type Property = (run: VerdictInput, result: VerdictResult) => boolean;
/** The shrunk counterexample, in fast-check's words, or undefined when the property held. */
function counterexample(property: Property): string | undefined {
	const details = fc.check(
		fc.property(input, (run) => property(run, reduceVerdict(run))),
		{ numRuns: 3000 },
	) as fc.RunDetails<[VerdictInput]>;
	return details.failed ? (fc.defaultReportMessage(details) ?? "failed") : undefined;
}
/** A failure the agent could have caused: a recorded check error, with nothing typed above it. */
function operationsReport(attempt: VerdictAttempt, kind: string): boolean {
	return attempt.operations.some(({ data }) =>
		data.some((item) => (item as { kind: string }).kind === kind),
	);
}
/** Typed evidence the agent caused it: a check that failed after it started, or its own outcome. */
function agentEvidence(attempt: VerdictAttempt): boolean {
	return attempt.checkFailed === true || operationsReport(attempt, "agent");
}
/** A failure the agent could have caused, with nothing typed above it that would void the attempt. */
function chargeableToAgent(attempt: VerdictAttempt): boolean {
	const messages = attempt.errors.map((item) => (item as { message: string }).message);
	return (
		attempt.status === "failed" &&
		!attempt.timedOut &&
		!operationsReport(attempt, "infrastructure") &&
		!attempt.errors.includes(WORKER_CRASH) &&
		!messages.some((message) => TYPED.test(message)) &&
		agentEvidence(attempt)
	);
}
function passedOnItsOwn(attempt: VerdictAttempt): boolean {
	if (attempt.status === "passed") return !attempt.survivedControl;
	return (
		attempt.expectedFailure === true &&
		attempt.checkFailed === true &&
		attempt.namedCheckFailed !== false &&
		chargeableToAgent(attempt)
	);
}

function unfinished({ status }: VerdictAttempt): boolean {
	return status === "running" || status === "interrupted";
}
function unplanned({ sample }: VerdictAttempt): boolean {
	return sample !== undefined && sample.flagAt === undefined;
}
const exitsZeroOnlyAsPassOrListing: Property = (_, { verdict, exitCode }) =>
	exitCode !== 0 || verdict === "passed" || verdict === "listed";
const passesOnlyComplete: Property = (run, { verdict }) => {
	const started = new Set(run.attempts.map(({ testId }) => testId));
	const complete = (run.plannedTests ?? []).every((testId) => started.has(testId));
	return verdict !== "passed" || (!run.interrupted && complete && !run.attempts.some(unfinished));
};
const passesOnEvidence: Property = (run, { verdict }) =>
	verdict !== "passed" || run.attempts.some(passedOnItsOwn);
const blamesOnlyOnEvidence: Property = (run, { exitCode }) =>
	exitCode !== 1 ||
	run.attempts.some((attempt) => attempt.survivedControl || chargeableToAgent(attempt));
const passesOnlyUnderStrongConditions: Property = (run, { verdict }) =>
	verdict !== "passed" ||
	run.attempts.flatMap(attemptRecords).every((record) => recordWeaknesses(record).length === 0);
const orderFree: Property = (run, { verdict }) =>
	reduceVerdict({ ...run, attempts: [...run.attempts].reverse() }).verdict === verdict;
const unplannedRateNeverPasses: Property = (run, { claimVerdicts = {} }) =>
	!run.attempts.some(unplanned) || claimVerdicts.claim !== "passed";
const FAILED_CHECK: VerdictAttempt = {
	testId: "z",
	retry: 0,
	status: "failed",
	errors: [{ message: MESSAGES[0], stack: "at test" }],
	operations: [],
};
const aFailedCheckNeverExitsZero: Property = (run) =>
	run.listOnly ||
	reduceVerdict({ ...run, attempts: [...run.attempts, FAILED_CHECK], runnerExitCode: 1 })
		.exitCode !== 0;

describe("reduceVerdict properties", () => {
	it("exits 0 only as a pass or a listing", () =>
		expect(counterexample(exitsZeroOnlyAsPassOrListing)).toBeUndefined());
	it("never passes a run that was interrupted, unfinished, or left a test unstarted", () =>
		expect(counterexample(passesOnlyComplete)).toBeUndefined());
	it("passes only on an attempt that passed on its own evidence", () =>
		expect(counterexample(passesOnEvidence)).toBeUndefined());
	it("blames the agent only for a recorded check failure or a control that survived", () =>
		expect(counterexample(blamesOnlyOnEvidence)).toBeUndefined());
	it("passes only when every run's recorded conditions can carry a pass", () =>
		expect(counterexample(passesOnlyUnderStrongConditions)).toBeUndefined());
	it("does not depend on the order the attempts arrive in", () =>
		expect(counterexample(orderFree)).toBeUndefined());
	it("a rate with no plan never passes, however it went", () =>
		expect(counterexample(unplannedRateNeverPasses)).toBeUndefined());
	it("a new test that failed a check never leaves the run at exit 0", () =>
		expect(counterexample(aFailedCheckNeverExitsZero)).toBeUndefined());
	it("a run with nothing in it is never a pass", () => {
		const empty = { attempts: [], interrupted: false, listOnly: false, runnerExitCode: 0 };
		expect(reduceVerdict(empty).verdict).not.toBe("passed");
	});
});
