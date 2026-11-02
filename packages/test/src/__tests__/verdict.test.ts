import { describe, expect, it } from "bun:test";
import {
	reduceVerdict,
	type VerdictAttempt,
	verdictNotes,
	verdictSentence,
} from "../sdk/verdict.js";

const attempt = (overrides: Partial<VerdictAttempt>): VerdictAttempt => ({
	testId: "a",
	retry: 0,
	status: "passed",
	errors: [],
	operations: [],
	...overrides,
});
const reduce = (attempts: VerdictAttempt[], runnerExitCode = 0, extra = {}) =>
	reduceVerdict({ attempts, interrupted: false, listOnly: false, runnerExitCode, ...extra });
/** A failed check after the agent started, as the reporter records an assertion that failed. */
const failed = (message: string, testId = "a") =>
	attempt({ testId, status: "failed", checkFailed: true, errors: [{ message }] });

describe("reduceVerdict", () => {
	it("passed needs every test to pass and the runner to agree", () => {
		expect(reduce([attempt({})])).toMatchObject({ verdict: "passed", exitCode: 0 });
		expect(reduce([attempt({})], 1).verdict).toBe("instrument_error");
	});
	it("a failure the runner did not report is an instrument error, not a pass", () => {
		expect(reduce([failed("Expected 1")], 0)).toMatchObject({
			verdict: "instrument_error",
			exitCode: 2,
		});
	});
	it("an expected failure counts as passing", () => {
		const expected = attempt({
			status: "failed",
			expectedFailure: true,
			checkFailed: true,
			errors: [{ message: "Error: Expected 1" }],
		});
		expect(reduce([expected]).verdict).toBe("passed");
	});
	it("classifies each kind of failure", () => {
		expect(reduce([failed("Expected 1")], 1).verdict).toBe("agent_failed");
		expect(reduce([failed("AgentInfrastructureError: auth")], 1).verdict).toBe("infra_invalid");
		const timedOut = attempt({ status: "failed", timedOut: true, errors: [{ message: "Late" }] });
		expect(reduce([timedOut], 1).verdict).toBe("infra_invalid");
		expect(reduce([failed("ConditionsUnknownError: no catalog")], 1).verdict).toBe(
			"conditions_unknown",
		);
		expect(reduce([failed("UnearnedResultError: no agent ran")], 1).verdict).toBe("vacuous");
	});
	it("an infrastructure failure seen by an operation counts even under another error", () => {
		const hidden = attempt({
			status: "failed",
			errors: [{ message: "Expected 1" }],
			operations: [{ data: [{ kind: "infrastructure", code: "auth" }] }],
		});
		expect(reduce([hidden], 1).verdict).toBe("infra_invalid");
	});
});

describe("reduceVerdict across attempts", () => {
	it("a pass after a failed try is flaky", () => {
		const attempts = [failed("Expected 1"), attempt({ retry: 1 })];
		expect(reduce(attempts)).toMatchObject({ verdict: "flaky", exitCode: 2 });
	});
	it("a real agent failure outranks a test with no verdict", () => {
		const attempts = [failed("Expected 1", "a"), failed("AgentInfrastructureError", "b")];
		expect(reduce(attempts, 1)).toMatchObject({
			verdict: "agent_failed",
			exitCode: 1,
			tests: { a: "agent_failed", b: "infra_invalid" },
		});
	});
	it("no attempts and only skipped tests have no verdict", () => {
		expect(reduce([])).toMatchObject({ verdict: "skipped_only", exitCode: 2 });
		expect(reduce([attempt({ status: "skipped" })])).toMatchObject({ verdict: "skipped_only" });
	});
	it("skipped tests do not spoil a pass", () => {
		const attempts = [attempt({}), attempt({ testId: "b", status: "skipped" })];
		expect(reduce(attempts)).toMatchObject({ verdict: "passed", counts: { passed: 1, total: 1 } });
	});
});

describe("reduceVerdict controls", () => {
	it("a control that passes is a failure, not a pass", () => {
		const survived = attempt({ status: "passed", survivedControl: true });
		expect(reduce([survived], 1)).toMatchObject({ verdict: "control_survived", exitCode: 1 });
	});
	it("a control that failed on a check counts as passing", () => {
		const rejected = attempt({
			status: "failed",
			expectedFailure: true,
			checkFailed: true,
			errors: [{ message: "Expected 1" }],
		});
		expect(reduce([rejected]).verdict).toBe("passed");
	});
	it("a control the host broke proves nothing", () => {
		const broken = attempt({
			status: "failed",
			expectedFailure: true,
			errors: [{ message: "AgentInfrastructureError: auth" }],
		});
		expect(reduce([broken]).verdict).toBe("infra_invalid");
	});
});

describe("reduceVerdict on runner failures", () => {
	it("a cleanup failure after a passing test says nothing about the agent", () => {
		expect(reduce([failed("RunnerCleanupError: EACCES")], 1).verdict).toBe("infra_invalid");
	});
	it("any other failure still stands if cleanup failed too", () => {
		const both = attempt({
			status: "failed",
			errors: [
				{ message: "WorkspaceEscapeError: /etc" },
				{ message: "RunnerCleanupError: EACCES" },
			],
			operations: [{ data: [{ kind: "agent", message: "Agent used paths outside" }] }],
		});
		expect(reduce([both], 1).verdict).toBe("agent_failed");
	});
});

describe("reduceVerdict on who caused a failure", () => {
	const thrown = (message: string, operations: VerdictAttempt["operations"] = []) =>
		attempt({ status: "failed", errors: [{ message }], operations });
	it("the test's own code failing after the agent ran is not the agent's failure", () => {
		const result = reduce([thrown("TypeError: Cannot read properties of undefined")], 1);
		expect(result).toMatchObject({ verdict: "author_error", exitCode: 2 });
	});
	it("the agent's own outcome, as the host reported it, is the agent's failure", () => {
		const outcome = [{ data: [{ kind: "agent", message: "error_max_turns" }] }];
		expect(reduce([thrown("AgentOutcomeError: error_max_turns", outcome)], 1).verdict).toBe(
			"agent_failed",
		);
	});
	it("an operation that failed for a reason nobody typed is the instrument's", () => {
		const untyped = [{ data: [{ kind: "runtime", message: "adapter broke" }] }];
		expect(reduce([thrown("Error: adapter broke", untyped)], 1).verdict).toBe("instrument_error");
	});
	it("a check that failed after the agent ran is the agent's, beside an untyped error", () => {
		const untyped = [{ data: [{ kind: "runtime", message: "adapter broke" }] }];
		const checked = {
			...thrown("Error: expect(received).toBe(expected)", untyped),
			checkFailed: true,
		};
		expect(reduce([checked], 1).verdict).toBe("agent_failed");
	});
	it("a sample that failed in the test's own code counts as no verdict, not a failure", () => {
		const sample = { title: "claim", n: 1, flagAt: 1 };
		const broken = { ...thrown("TypeError: x is not a function"), claim: "claim", sample };
		const result = reduce([broken], 1);
		expect(result.claims[0]?.arms[0]).toMatchObject({ failed: 0, noVerdict: 1 });
		expect(result.verdict).toBe("infra_invalid");
	});
});

describe("reduceVerdict special runs", () => {
	it("interruption and listing say so", () => {
		expect(reduce([attempt({})], 0, { interrupted: true })).toMatchObject({
			verdict: "interrupted",
			exitCode: 2,
		});
		expect(reduce([], 0, { listOnly: true })).toMatchObject({ verdict: "listed", exitCode: 0 });
	});
});

describe("verdictSentence", () => {
	it("reports a count of runs and claims no reliability", () => {
		const sentence = verdictSentence(reduce([attempt({})]));
		expect(sentence).toBe("Passed, 1 of 1 tests, one run each");
		expect(sentence.toLowerCase()).not.toContain("reliable");
	});
	it("says no verdict when there is none", () => {
		expect(verdictSentence(reduce([failed("AgentInfrastructureError")], 1))).toContain(
			"No verdict",
		);
	});
});

describe("reduceVerdict with a baseline", () => {
	const record = {
		host: "claude",
		requestedModel: "m",
		binaryVersion: "1",
		confinement: "host-enforced",
		network: "disabled",
		hashes: { suite: "s", prompt: "p", skills: "k", initialSnapshot: "w" },
	};
	const sampled = (status: VerdictAttempt["status"], index: number) =>
		attempt({
			testId: `t${index}`,
			claim: "claim",
			status,
			sample: { title: "claim", n: 27 },
			checkFailed: status === "failed",
			errors: status === "failed" ? [{ message: "Expected 1" }] : [],
			operations: [{ data: [{ record }] }],
		});
	const attempts = (passed: number, failed: number) => [
		...Array.from({ length: passed }, (_, index) => sampled("passed", index)),
		...Array.from({ length: failed }, (_, index) => sampled("failed", passed + index)),
	];
	const fingerprint = reduce(attempts(27, 0)).claims[0]?.fingerprint ?? "";
	const baselines = {
		claim: { claim: "claim", fingerprint, passed: 27, total: 27, at: "then" },
	};
	it("a claim that regressed from its baseline fails the run", () => {
		const result = reduce(attempts(10, 17), 1, { baselines });
		expect(result).toMatchObject({ verdict: "agent_failed", exitCode: 1 });
	});
	it("a plan short of verdicts that regressed still fails the run", () => {
		const sample = { title: "claim", n: 27, flagAt: 20 };
		const planned = attempts(3, 10).map((run) => ({ ...run, sample }));
		const result = reduce(planned, 1, { baselines });
		expect(result.claims[0]?.decision).toBe("no_verdict");
		expect(result).toMatchObject({ verdict: "agent_failed", exitCode: 1 });
	});
	it("a claim consistent with its baseline, with no plan, is only indicative", () => {
		const result = reduce(attempts(26, 1), 1, { baselines });
		expect(result).toMatchObject({ verdict: "indicative", exitCode: 3 });
	});
});

describe("reduceVerdict with repeats from the command line", () => {
	const repeat = (status: VerdictAttempt["status"], testId: string) =>
		attempt({
			testId,
			claim: "claim",
			status,
			checkFailed: status === "failed",
			errors: status === "failed" ? [{ message: "Expected 1" }] : [],
		});
	const attempts = [repeat("passed", "a"), repeat("failed", "b")];
	it("a failed repeat fails the run", () => {
		expect(reduce(attempts, 1)).toMatchObject({ verdict: "agent_failed", exitCode: 1 });
	});
	it("--measure reports the same repeats as a rate, which cannot pass", () => {
		expect(reduce(attempts, 1, { measureRepeats: true })).toMatchObject({
			verdict: "indicative",
			exitCode: 3,
		});
	});
	it("--allow-indicative exits 0 on a rate and says why", () => {
		const result = reduce(attempts, 1, { measureRepeats: true, allowIndicative: true });
		expect(result).toMatchObject({ verdict: "indicative", exitCode: 0, indicativeAllowed: true });
		expect(verdictNotes(result)).toEqual(["Exit 0 only because --allow-indicative was given"]);
	});
	it("--allow-indicative does not touch a failure", () => {
		expect(reduce(attempts, 1, { allowIndicative: true }).exitCode).toBe(1);
	});
	it("repeats that all pass exit 0", () => {
		expect(reduce([repeat("passed", "a"), repeat("passed", "b")]).exitCode).toBe(0);
	});
});

describe("reduceVerdict on runs that did not finish", () => {
	const sampled = (testId: string, status: VerdictAttempt["status"]) =>
		attempt({
			testId,
			claim: "claim",
			status,
			sample: { title: "claim", n: 2 },
			checkFailed: status === "failed",
			errors: status === "failed" ? [{ message: "Expected 1" }] : [],
		});
	it("a test that never started leaves a rate with no verdict", () => {
		const result = reduce([sampled("a", "failed")], 1, { plannedTests: ["a", "b"] });
		expect(result).toMatchObject({ verdict: "interrupted", exitCode: 2, notRun: 1 });
	});
	it("a runner failure outside any test is not excused by a failed sample", () => {
		const result = reduce([sampled("a", "failed")], 1, { runnerReportedError: true });
		expect(result).toMatchObject({ verdict: "instrument_error", exitCode: 2 });
	});
	it("an unreadable baseline leaves a sampled run with no verdict, and names the file", () => {
		const result = reduce([sampled("a", "passed")], 0, { unreadableBaselines: ["bad.json"] });
		expect(result).toMatchObject({ verdict: "conditions_unknown", exitCode: 2 });
		expect(verdictNotes(result)).toEqual(["Baseline files could not be read: bad.json"]);
	});
	it("an unreadable baseline does not touch a run with nothing sampled", () => {
		expect(reduce([attempt({})], 0, { unreadableBaselines: ["bad.json"] }).verdict).toBe("passed");
	});
});

describe("reduceVerdict on lost or mixed evidence", () => {
	it("a failure with no recorded error is the instrument's, whoever it would blame", () => {
		const lost = attempt({ status: "failed", expectedFailure: true, checkFailed: true });
		expect(reduce([lost]).verdict).toBe("instrument_error");
		expect(reduce([attempt({ status: "failed" })], 1).verdict).toBe("instrument_error");
	});
	it("an unfinished sample leaves the run with no verdict", () => {
		const sample = { title: "claim", n: 2, flagAt: 2 };
		const sampled = (testId: string, status: VerdictAttempt["status"]) =>
			attempt({ testId, claim: "claim", sample, status });
		expect(reduce([sampled("a", "passed"), sampled("b", "running")]).verdict).toBe("interrupted");
	});
	it("samples that disagree on their plan cannot be decided by either", () => {
		const sampled = (testId: string, flagAt?: number) =>
			attempt({ testId, claim: "claim", sample: { title: "claim", n: 2, flagAt } });
		expect(reduce([sampled("a", 1), sampled("b")]).verdict).toBe("instrument_error");
	});
});

describe("reduceVerdict on controls that name their check", () => {
	const control = (namedCheckFailed: boolean) =>
		attempt({
			status: "failed",
			expectedFailure: true,
			checkFailed: true,
			namedCheckFailed,
			errors: [{ message: "Error: The agent called the tool." }],
		});
	it("a control that failed on the check it names counts as passing", () => {
		expect(reduce([control(true)]).verdict).toBe("passed");
	});
	it("a control that failed on another check, such as a precondition, proves nothing", () => {
		expect(reduce([control(false)], 0)).toMatchObject({ verdict: "vacuous", exitCode: 2 });
	});
});
