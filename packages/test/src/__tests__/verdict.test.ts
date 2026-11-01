import { describe, expect, it } from "bun:test";
import { reduceVerdict, type VerdictAttempt, verdictSentence } from "../sdk/verdict.js";

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
const failed = (message: string, testId = "a") =>
	attempt({ testId, status: "failed", errors: [{ message }] });

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
		const expected = attempt({ status: "failed", expectedFailure: true });
		expect(reduce([expected]).verdict).toBe("passed");
	});
	it("classifies each kind of failure", () => {
		expect(reduce([failed("Expected 1")], 1).verdict).toBe("agent_failed");
		expect(reduce([failed("AgentInfrastructureError: auth")], 1).verdict).toBe("infra_invalid");
		expect(reduce([failed("Test timeout of 100ms exceeded.")], 1).verdict).toBe("infra_invalid");
		expect(reduce([failed("ConditionsUnknownError: no catalog")], 1).verdict).toBe(
			"conditions_unknown",
		);
		expect(reduce([failed("finished without a completed agent operation")], 1).verdict).toBe(
			"vacuous",
		);
		expect(
			reduce([failed("2 agent operation(s) were not awaited and did not complete")], 1).verdict,
		).toBe("vacuous");
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
	it("a claim consistent with its baseline stays measured", () => {
		const result = reduce(attempts(26, 1), 1, { baselines });
		expect(result).toMatchObject({ verdict: "measured", exitCode: 0 });
	});
});

describe("reduceVerdict with repeats from the command line", () => {
	const repeat = (status: VerdictAttempt["status"], testId: string) =>
		attempt({
			testId,
			claim: "claim",
			status,
			errors: status === "failed" ? [{ message: "Expected 1" }] : [],
		});
	const attempts = [repeat("passed", "a"), repeat("failed", "b")];
	it("a failed repeat fails the run", () => {
		expect(reduce(attempts, 1)).toMatchObject({ verdict: "agent_failed", exitCode: 1 });
	});
	it("--measure reports the same repeats as a rate", () => {
		expect(reduce(attempts, 1, { measureRepeats: true })).toMatchObject({
			verdict: "measured",
			exitCode: 0,
		});
	});
	it("repeats that all pass exit 0", () => {
		expect(reduce([repeat("passed", "a"), repeat("passed", "b")]).exitCode).toBe(0);
	});
});
