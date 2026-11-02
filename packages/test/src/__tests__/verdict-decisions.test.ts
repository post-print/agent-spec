import { describe, expect, it } from "bun:test";
import { failedOnlyOnUncalibratedJudges } from "../sdk/check-outcomes.js";
import { recordWeaknesses } from "../sdk/claim-strength.js";
import { buildClaims, type ClaimSample } from "../sdk/claims.js";
import {
	EXIT_ZERO_PATHS,
	reduceVerdict,
	sampleOutcome,
	type VerdictAttempt,
	type VerdictInput,
	verdictNotes,
} from "../sdk/verdict.js";

/**
 * One case per decision the verdict rests on, each written so the decision going the other way
 * changes the result. The mutation audit (`bun run test:mutation`) found these unpinned.
 */
const attempt = (overrides: Partial<VerdictAttempt>): VerdictAttempt => ({
	testId: "a",
	retry: 0,
	status: "passed",
	errors: [],
	operations: [],
	...overrides,
});
const checkFailure = (overrides: Partial<VerdictAttempt> = {}) =>
	attempt({
		status: "failed",
		checkFailed: true,
		errors: [{ message: "Error: Expected 1" }],
		...overrides,
	});
const infraFailure = (overrides: Partial<VerdictAttempt> = {}) =>
	attempt({
		status: "failed",
		errors: [{ message: "AgentInfrastructureError: auth" }],
		...overrides,
	});
const run = (attempts: VerdictAttempt[], extra: Partial<VerdictInput> = {}) =>
	reduceVerdict({ attempts, interrupted: false, listOnly: false, runnerExitCode: 0, ...extra });
const sample = (outcome: ClaimSample["outcome"], flagAt?: number, n = 4): ClaimSample => ({
	claim: "claim",
	sample: { title: "claim", n, flagAt },
	outcome,
});

describe("the exit-0 evidence check, on its own", () => {
	const input = { attempts: [], interrupted: false, listOnly: false, runnerExitCode: 0 };
	const evidence = { input, tests: { a: "passed" as const }, claims: [], claimVerdicts: {} };
	it("accepts tests that all passed", () => {
		expect(EXIT_ZERO_PATHS.passed(evidence)).toBe(true);
		expect(EXIT_ZERO_PATHS.passed({ ...evidence, tests: { a: "passed", b: "skipped_only" } })).toBe(
			true,
		);
	});
	it("refuses a run with nothing that passed, anything else, an interruption, or a test never started", () => {
		expect(EXIT_ZERO_PATHS.passed({ ...evidence, tests: {} })).toBe(false);
		expect(EXIT_ZERO_PATHS.passed({ ...evidence, tests: { a: "passed", b: "flaky" } })).toBe(false);
		expect(EXIT_ZERO_PATHS.passed({ ...evidence, input: { ...input, interrupted: true } })).toBe(
			false,
		);
		const unstarted = { ...input, plannedTests: ["a", "b"], attempts: [attempt({})] };
		expect(EXIT_ZERO_PATHS.passed({ ...evidence, input: unstarted })).toBe(false);
	});
	it("refuses a passed claim whose plan did not clear, unless every command-line repeat passed", () => {
		const [unplanned] = buildClaims([sample("passed")]);
		if (!unplanned) throw new Error("no claim");
		const claims = {
			...evidence,
			claims: [unplanned],
			claimVerdicts: { claim: "passed" as const },
		};
		expect(EXIT_ZERO_PATHS.passed(claims)).toBe(false);
		const repeated = { ...unplanned, declared: false };
		expect(EXIT_ZERO_PATHS.passed({ ...claims, claims: [repeated] })).toBe(true);
		const withFailure = { ...repeated, arms: repeated.arms.map((arm) => ({ ...arm, failed: 1 })) };
		expect(EXIT_ZERO_PATHS.passed({ ...claims, claims: [withFailure] })).toBe(false);
		const measuring = { ...claims, claims: [repeated], input: { ...input, measureRepeats: true } };
		expect(EXIT_ZERO_PATHS.passed(measuring)).toBe(false);
	});
	it("lists only a listing and an accepted run as the other ways to exit 0", () => {
		expect(EXIT_ZERO_PATHS.listed({ ...evidence, input: { ...input, listOnly: true } })).toBe(true);
		expect(EXIT_ZERO_PATHS.listed(evidence)).toBe(false);
		expect(Object.keys(EXIT_ZERO_PATHS).sort()).toEqual(["accepted", "listed", "passed"]);
	});
	it("takes an accepted run only when one test was accepted and nothing else failed", () => {
		const accepted = { ...evidence, tests: { a: "accepted" as const, b: "passed" as const } };
		expect(EXIT_ZERO_PATHS.accepted(accepted)).toBe(true);
		expect(EXIT_ZERO_PATHS.passed(accepted)).toBe(false);
		expect(EXIT_ZERO_PATHS.accepted(evidence)).toBe(false);
		const failing = { ...evidence, tests: { a: "accepted" as const, b: "indicative" as const } };
		expect(EXIT_ZERO_PATHS.accepted(failing)).toBe(false);
	});
});

describe("a sampling plan's decision", () => {
	it("flags as soon as failures reach the flag, not only past it", () => {
		const [at] = buildClaims([sample("failed", 2), sample("failed", 2), sample("passed", 2)]);
		expect(at?.decision).toBe("flagged");
		const [below] = buildClaims([sample("failed", 2), sample("passed", 2), sample("passed", 2)]);
		expect(below?.decision).not.toBe("flagged");
	});
	it("clears only when the failures still possible cannot reach the flag", () => {
		const passes = (count: number) => Array.from({ length: count }, () => sample("passed", 2));
		expect(buildClaims(passes(3))[0]?.decision).toBe("clear");
		expect(buildClaims(passes(2))[0]?.decision).toBe("no_verdict");
	});
	it("is only measured with no flag", () => {
		expect(buildClaims([sample("passed"), sample("failed")])[0]?.decision).toBe("measured");
	});
});

describe("a claim's verdict", () => {
	const declared = (samples: VerdictAttempt[]) => run(samples, { runnerExitCode: 1 });
	const sampled = (overrides: Partial<VerdictAttempt>, flagAt?: number) =>
		attempt({ claim: "claim", sample: { title: "claim", n: 2, flagAt }, ...overrides });
	it("a control surviving in one sample fails the claim", () => {
		const result = declared([
			sampled({ testId: "a", survivedControl: true }, 1),
			sampled({ testId: "b" }, 1),
		]);
		expect(result.claimVerdicts?.claim).toBe("control_survived");
	});
	it("a flagged plan fails, and a cleared one passes", () => {
		const flagged = declared([
			sampled({ ...checkFailure(), testId: "a" }, 1),
			sampled({ testId: "b" }, 1),
		]);
		expect(flagged.claimVerdicts?.claim).toBe("agent_failed");
		expect(
			run([sampled({ testId: "a" }, 2), sampled({ testId: "b" }, 2)]).claimVerdicts?.claim,
		).toBe("passed");
	});
	it("a command-line repeat with no verdict keeps the gate from passing", () => {
		const repeat = (overrides: Partial<VerdictAttempt>) =>
			attempt({ claim: "claim", ...overrides });
		const result = run([repeat({ testId: "a" }), repeat({ ...infraFailure(), testId: "b" })], {
			runnerExitCode: 1,
		});
		expect(result.claimVerdicts?.claim).toBe("infra_invalid");
		const failed = run([repeat({ testId: "a" }), repeat({ ...checkFailure(), testId: "b" })], {
			runnerExitCode: 1,
		});
		expect(failed.claimVerdicts?.claim).toBe("agent_failed");
	});
});

describe("claims and the samples they hold", () => {
	it("one title run once is a test, not a claim; run twice it is a claim", () => {
		expect(run([attempt({ claim: "claim" })]).claims).toHaveLength(0);
		const twice = run([attempt({ claim: "claim" }), attempt({ testId: "b", claim: "claim" })]);
		expect(twice.claims).toHaveLength(1);
	});
	it("weighs only its own samples' conditions", () => {
		const strong = {
			host: "claude",
			calibrated: true,
			confinementProven: true,
			modelPinned: true,
			userConfig: "excluded",
			confinement: "host-enforced",
		};
		const withRecord = (record: object) => [{ data: [{ record }] }];
		const result = run([
			attempt({
				testId: "a",
				claim: "x",
				sample: { title: "x", n: 1, flagAt: 1 },
				operations: withRecord(strong),
			}),
			attempt({
				testId: "b",
				claim: "y",
				sample: { title: "y", n: 1, flagAt: 1 },
				operations: withRecord({ ...strong, calibrated: false }),
			}),
		]);
		expect(result.claimVerdicts).toEqual({ x: "passed", y: "indicative" });
	});
});

describe("a test's verdict across attempts", () => {
	it("a control that survives on any attempt fails the test", () => {
		const attempts = [attempt({ survivedControl: true }), attempt({ retry: 1 })];
		expect(run(attempts, { runnerExitCode: 1 }).verdict).toBe("control_survived");
	});
	it("the last attempt is the latest retry, whatever order they arrive in", () => {
		const attempts = [attempt({ retry: 1 }), checkFailure({ retry: 0 })];
		expect(run(attempts).verdict).toBe("flaky");
	});
	it("a test whose latest attempt is still running or was stopped is interrupted", () => {
		expect(run([attempt({ status: "running" })]).tests.a).toBe("interrupted");
		expect(run([attempt({ status: "interrupted" })]).tests.a).toBe("interrupted");
	});
	it("a real failure on one try is not undone by the host breaking on the next", () => {
		const attempts = [checkFailure({ retry: 0 }), infraFailure({ retry: 1 })];
		expect(run(attempts, { runnerExitCode: 1 }).verdict).toBe("agent_failed");
		expect(
			run([infraFailure({ retry: 0 }), infraFailure({ retry: 1 })], { runnerExitCode: 1 }).verdict,
		).toBe("infra_invalid");
	});
	it("an exit 1 after a retry is not a disagreement with a runner that exited 0", () => {
		const attempts = [infraFailure({ retry: 0 }), checkFailure({ retry: 1 })];
		expect(run(attempts, { runnerExitCode: 0 }).verdict).toBe("agent_failed");
		expect(run([checkFailure()], { runnerExitCode: 0 }).verdict).toBe("instrument_error");
	});
});

describe("one sample's outcome", () => {
	it("reads a skip as not run, a surviving control as failed, and anything unfinished as no verdict", () => {
		expect(sampleOutcome(attempt({ status: "skipped" }))).toBe("not_run");
		expect(sampleOutcome(attempt({ survivedControl: true }))).toBe("failed");
		expect(sampleOutcome(attempt({ status: "interrupted" }))).toBe("no_verdict");
	});
	it("counts a retried sample once, at the first attempt to reach a verdict", () => {
		const plan = { title: "claim", n: 2, flagAt: 2 };
		const retried = run(
			[
				attempt({ retry: 1, claim: "claim", sample: plan }),
				checkFailure({ retry: 0, claim: "claim", sample: plan }),
			],
			{ runnerExitCode: 1 },
		);
		expect(retried.claims[0]?.arms[0]).toMatchObject({ failed: 1, passed: 0 });
	});
});

describe("the run around its tests", () => {
	it("tolerates a runner exit 1 only for failed samples", () => {
		const plan = { title: "claim", n: 2, flagAt: 2 };
		const samples = [
			checkFailure({ testId: "a", claim: "claim", sample: plan }),
			attempt({ testId: "b", claim: "claim", sample: plan }),
		];
		expect(run(samples, { runnerExitCode: 1 }).verdict).not.toBe("instrument_error");
		expect(run([attempt({})], { runnerExitCode: 1 }).verdict).toBe("instrument_error");
	});
	it("counts the tests that passed", () => {
		expect(run([attempt({}), attempt({ testId: "b" })]).counts).toEqual({ passed: 2, total: 2 });
		expect(run([attempt({}), checkFailure({ testId: "b" })], { runnerExitCode: 1 }).counts).toEqual(
			{
				passed: 1,
				total: 2,
			},
		);
	});
	it("marks an allowed exit 0 only on an indicative run", () => {
		expect(run([attempt({})], { allowIndicative: true }).indicativeAllowed).toBeUndefined();
	});
});

describe("a record's weaknesses", () => {
	const strong = {
		host: "claude",
		calibrated: true,
		confinementProven: true,
		modelPinned: true,
		userConfig: "excluded",
		confinement: "host-enforced",
	};
	it("names a host-enforced run with no escape battery that held", () => {
		expect(recordWeaknesses(strong)).toEqual([]);
		expect(recordWeaknesses({ ...strong, confinementProven: false })).toEqual([
			{
				condition: "escape-battery",
				reason:
					"claude has no escape battery from the last week in which every enforced vector held",
			},
		]);
	});
	it("names a detect-only host once, without asking it for a battery it cannot pass", () => {
		expect(
			recordWeaknesses({ ...strong, confinement: "detect-only", confinementProven: false }),
		).toEqual([{ condition: "confinement", reason: "claude only detects escapes" }]);
	});
});

describe("a plan with two arms", () => {
	const armSample = (variant: string, outcome: ClaimSample["outcome"]): ClaimSample => ({
		claim: "claim",
		sample: { title: "claim", variant, arms: ["a", "b"], n: 3, flagAt: 2 },
		outcome,
	});
	it("flags when either arm reaches the flag", () => {
		const samples = [armSample("a", "failed"), armSample("a", "failed"), armSample("b", "passed")];
		expect(buildClaims(samples)[0]?.decision).toBe("flagged");
	});
	it("clears only when both arms have cleared", () => {
		const cleared = ["a", "b"].flatMap((variant) => [
			armSample(variant, "passed"),
			armSample(variant, "passed"),
		]);
		expect(buildClaims(cleared)[0]?.decision).toBe("clear");
		const oneShort = [armSample("a", "passed"), armSample("a", "passed"), armSample("b", "passed")];
		expect(buildClaims(oneShort)[0]?.decision).toBe("no_verdict");
	});
});

describe("why an indicative run is not a pass", () => {
	it("calls a claim a rate with no plan only when it has none", () => {
		const weak = {
			host: "claude",
			calibrated: false,
			confinementProven: true,
			modelPinned: true,
			userConfig: "excluded",
			confinement: "host-enforced",
		};
		const planned = attempt({
			claim: "claim",
			sample: { title: "claim", n: 1, flagAt: 1 },
			operations: [{ data: [{ record: weak }] }],
		});
		const result = run([planned]);
		expect(result.verdict).toBe("indicative");
		expect(result.weakConditions).toEqual(["claude has no passing host probe from the last week"]);
	});
});

describe("a judge nobody calibrated", () => {
	const uncalibrated = new Set(["judge-1"]);
	it("is blamed only when every failed check read its evidence from it", () => {
		const onJudge = { passed: false, owners: ["judge-1"] };
		expect(failedOnlyOnUncalibratedJudges([onJudge], uncalibrated)).toBe(true);
		const onRun = { passed: false, owners: ["run-1"] };
		expect(failedOnlyOnUncalibratedJudges([onJudge, onRun], uncalibrated)).toBe(false);
		expect(failedOnlyOnUncalibratedJudges([{ passed: false, owners: [] }], uncalibrated)).toBe(
			false,
		);
		expect(
			failedOnlyOnUncalibratedJudges([{ passed: true, owners: ["judge-1"] }], uncalibrated),
		).toBe(false);
	});
	it("gives its failure no verdict, unless the agent's own outcome failed too", () => {
		expect(run([checkFailure({ judgeBlamed: true })], { runnerExitCode: 1 }).verdict).toBe(
			"infra_invalid",
		);
		const outcome = [{ data: [{ kind: "agent" }] }];
		const both = checkFailure({ judgeBlamed: true, operations: outcome });
		expect(run([both], { runnerExitCode: 1 }).verdict).toBe("agent_failed");
	});
});

// A custom adapter run unconfined in a real worktree: nothing calibrates or seals it.
const UNCONFINED = {
	host: "custom",
	calibrated: false,
	confinementProven: false,
	modelPinned: true,
	userConfig: "unknown",
	confinement: "detect-only",
};
const acceptOnly = (conditions: string[]) => ({
	conditions,
	reason: "PostPrint runs it unconfined",
});
const ranUnder = (record: object) => attempt({ operations: [{ data: [{ record }] }] });
describe("a suite that accepts weaker conditions", () => {
	const unconfined = UNCONFINED;
	const accept = acceptOnly;
	const ran = ranUnder;
	it("ends an unconfined pass as accepted, exit 0, and says what it went without", () => {
		const record = {
			...unconfined,
			accepted: accept(["calibration", "confinement", "user-config"]),
		};
		const result = run([ran(record)]);
		expect(result).toMatchObject({ verdict: "accepted", exitCode: 0 });
		expect(result.acceptedConditions?.reasons).toEqual(["PostPrint runs it unconfined"]);
		expect(verdictNotes(result)).toContain("Accepted: custom only detects escapes");
	});
	it("stays indicative when one weakness is not accepted", () => {
		const record = { ...unconfined, accepted: accept(["calibration", "confinement"]) };
		expect(run([ran(record)]).verdict).toBe("indicative");
	});
	it("leaves a failure a failure, and a strong pass a pass", () => {
		const record = {
			...unconfined,
			accepted: accept(["calibration", "confinement", "user-config"]),
		};
		const failed = checkFailure({ operations: [{ data: [{ record }] }] });
		expect(run([failed], { runnerExitCode: 1 }).verdict).toBe("agent_failed");
		const strong = {
			...unconfined,
			calibrated: true,
			userConfig: "excluded",
			confinement: "host-enforced",
			confinementProven: true,
		};
		expect(run([ran({ ...strong, accepted: accept(["calibration"]) })]).verdict).toBe("passed");
	});
	it("never accepts a rate with no plan", () => {
		const record = {
			...unconfined,
			accepted: accept(["calibration", "confinement", "user-config"]),
		};
		const unplanned = attempt({
			claim: "claim",
			sample: { title: "claim", n: 1 },
			operations: [{ data: [{ record }] }],
		});
		expect(run([unplanned]).verdict).toBe("indicative");
	});
});
