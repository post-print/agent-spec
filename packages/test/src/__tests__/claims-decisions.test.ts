import { describe, expect, it } from "bun:test";
import {
	type BaselineRecord,
	buildClaims,
	type ClaimResult,
	type ClaimSample,
	claimKey,
	claimLines,
} from "../sdk/claims.js";
import {
	reduceVerdict,
	type VerdictAttempt,
	type VerdictResult,
	verdictNotes,
	verdictSentence,
} from "../sdk/verdict.js";

/**
 * What a claim compares and says, one case per decision, so each one going the other way shows.
 * The mutation audit (`bun run test:mutation`) found these unpinned.
 */
const record = (overrides: Record<string, unknown> = {}) => ({
	host: "claude",
	binaryVersion: "1",
	authMode: "api-key",
	confinement: "host-enforced",
	network: "disabled",
	settingSources: [],
	userConfig: "excluded",
	home: "sealed",
	overridingEnv: [],
	requestedModel: "m",
	observedModel: "m",
	hashes: { suite: "s", settings: "t", prompt: "p", skills: "k", tools: "o", initialSnapshot: "w" },
	...overrides,
});
const sample = (
	outcome: ClaimSample["outcome"],
	extra: Partial<ClaimSample> = {},
): ClaimSample => ({
	claim: "claim",
	outcome,
	record: record(),
	...extra,
});
const only = (claims: ClaimResult[]): ClaimResult => {
	const [claim] = claims;
	if (!claim) throw new Error("Expected one claim");
	return claim;
};
const baselineFor = (claim: ClaimResult): Record<string, BaselineRecord> => ({
	claim: {
		claim: "claim",
		fingerprint: claim.fingerprint ?? "",
		passed: 10,
		total: 10,
		at: "then",
	},
});

const base = only(buildClaims([sample("passed")]));
describe("a claim's fingerprint", () => {
	const fields: [string, Record<string, unknown>][] = [
		["host", { host: "codex" }],
		["binaryVersion", { binaryVersion: "2" }],
		["authMode", { authMode: "subscription" }],
		["confinement", { confinement: "detect-only" }],
		["network", { network: "enabled" }],
		["settingSources", { settingSources: ["user"] }],
		["userConfig", { userConfig: "may-load" }],
		["home", { home: "readable" }],
		["allowedRoots", { allowedRoots: ["/opt/postprint"] }],
		["allowedTools", { allowedTools: ["Bash(bun run dev:status)"] }],
		["overridingEnv", { overridingEnv: ["CODEX_BIN"] }],
		["requestedModel", { requestedModel: "n" }],
		["observedModel", { observedModel: "n" }],
	];
	for (const [field, change] of fields)
		it(`changes with ${field}, so a baseline never compares across it`, () => {
			const changed = only(
				buildClaims([sample("passed", { record: record(change) })], baselineFor(base)),
			);
			expect(changed.baseline).toMatchObject({ status: "new_conditions", changed: [field] });
		});
	it("changes with each hash of what shaped the run", () => {
		for (const hash of ["suite", "settings", "prompt", "skills", "tools", "initialSnapshot"]) {
			const hashes = { ...record().hashes, [hash]: "changed" };
			const changed = only(
				buildClaims([sample("passed", { record: record({ hashes }) })], baselineFor(base)),
			);
			expect(changed.baseline).toMatchObject({
				status: "new_conditions",
				changed: [`hashes.${hash}`],
			});
		}
	});
});

describe("a claim's baseline", () => {
	it("names no change when either fingerprint cannot be read", () => {
		const unreadable = { claim: { ...baselineFor(base).claim, fingerprint: "not json" } } as Record<
			string,
			BaselineRecord
		>;
		const claim = only(
			buildClaims([sample("passed", { record: record({ host: "codex" }) })], unreadable),
		);
		expect(claim.baseline).toMatchObject({ status: "new_conditions", changed: undefined });
		const shorter = { claim: { ...baselineFor(base).claim, fingerprint: '["claude"]' } };
		const short = only(
			buildClaims([sample("passed", { record: record({ host: "codex" }) })], shorter),
		);
		expect(short.baseline).toMatchObject({ status: "new_conditions", changed: undefined });
	});
	it("compares nothing for a claim with two arms", () => {
		const arms = [
			sample("passed", { sample: { title: "claim", variant: "a", n: 1, subject: "prompt" } }),
			sample("passed", { sample: { title: "claim", variant: "b", n: 1, subject: "prompt" } }),
		];
		expect(only(buildClaims(arms, baselineFor(base))).baseline).toEqual({ status: "none" });
	});
});

describe("a comparison", () => {
	const arm = (variant?: string) => ({ title: "claim", variant, n: 1, subject: "prompt" as const });
	it("names its arms, and falls back to first and second", () => {
		const named = only(
			buildClaims([sample("passed", { sample: arm("a") }), sample("failed", { sample: arm("b") })]),
		);
		expect(named.comparison).toMatchObject({ first: "a", second: "b" });
	});
	it("refuses arms with no recorded conditions", () => {
		const bare = [
			sample("passed", { sample: arm("a"), record: undefined }),
			sample("failed", { sample: arm("b"), record: undefined }),
		];
		expect(only(buildClaims(bare)).comparisonRefused).toBe("no run recorded its conditions");
	});
});

describe("a claim's identity", () => {
	it("is its project and titles, with a sample's title in place of the last one", () => {
		expect(claimKey({ title: ["", "default", "file", "test"] })).toBe("default › file › test");
		expect(claimKey({ title: ["default", "file", "test [1/3]"], sample: { title: "test" } })).toBe(
			"default › file › test",
		);
	});
});

describe("what a claim says", () => {
	const lines = (claim: Partial<ClaimResult>) =>
		claimLines({ ...only(buildClaims([sample("passed")])), ...claim }).join("\n");
	it("states a flag, a clear plan, and a surviving control", () => {
		expect(lines({ decision: "flagged", flagAt: 3 })).toContain("flagged at 3 failures");
		expect(lines({ decision: "clear", flagAt: 3 })).toContain("clear of the flag at 3 failures");
		expect(lines({ decision: "measured" })).not.toContain("flag");
		expect(lines({ controlsSurvived: 2 })).toContain(
			"a control that must fail passed in 2 samples",
		);
		expect(lines({ controlsSurvived: 0 })).not.toContain("control");
	});
	it("states a baseline it matched, regressed from, or could not apply", () => {
		const same = { status: "same_conditions" as const, passed: 9, total: 10 };
		expect(lines({ baseline: { ...same, regressed: true } })).toContain(
			"regressed from baseline 9 of 10",
		);
		expect(lines({ baseline: { ...same, regressed: false } })).toContain(
			"consistent with baseline 9 of 10",
		);
		expect(lines({ baseline: { status: "none" } })).not.toContain("baseline");
		expect(lines({ baseline: { status: "new_conditions" } })).toContain(
			"conditions changed or are unknown, so no baseline applies",
		);
	});
	it("states a comparison, or why it was refused", () => {
		expect(lines({ comparisonRefused: "host differs between runs" })).toContain(
			"not compared: host differs between runs",
		);
		expect(lines({})).not.toContain("not compared");
		const difference = {
			difference: 0.5,
			low: 0.1,
			high: 0.9,
			distinguishable: true,
			first: "a",
			second: "b",
		};
		expect(lines({ comparison: difference })).toContain("a minus b: 50%");
	});
});

const attempt = (overrides: Partial<VerdictAttempt> = {}): VerdictAttempt => ({
	testId: "a",
	retry: 0,
	status: "passed",
	errors: [],
	operations: [],
	...overrides,
});
const run = (attempts: VerdictAttempt[], extra = {}): VerdictResult =>
	reduceVerdict({ attempts, interrupted: false, listOnly: false, runnerExitCode: 0, ...extra });
describe("what a run says", () => {
	it("gives a pass its counts, and other verdicts their own sentence", () => {
		expect(verdictSentence(run([attempt()]))).toBe("Passed, 1 of 1 tests, one run each");
		const plan = { title: "claim", n: 1, flagAt: 1 };
		const withClaim = run([attempt(), attempt({ testId: "b", claim: "claim", sample: plan })]);
		expect(verdictSentence(withClaim)).toBe(
			"Passed, 1 of 1 single-run tests and 1 sampled tests below",
		);
		expect(verdictSentence(run([], { listOnly: true }))).toBe("Listed tests only");
		expect(verdictSentence(run([attempt({ status: "skipped" })]))).toBe("No verdict: no test ran");
		expect(verdictSentence(run([attempt({ status: "interrupted" })]))).toContain(
			"(0 of 1 tests passed)",
		);
	});
	it("notes tests that never started", () => {
		const result = run([attempt()], { plannedTests: ["a", "b"] });
		expect(verdictNotes(result)).toEqual(["1 tests never started"]);
		expect(verdictNotes(run([attempt()]))).toEqual([]);
	});
});

describe("how a run reads its attempts", () => {
	it("reads a stackless worker crash as the runner's, and the same words thrown as an error as not", () => {
		const crash = { message: "Error: worker process exited unexpectedly (code 1)" };
		const crashed = attempt({ status: "failed", checkFailed: true, errors: [crash] });
		expect(run([crashed], { runnerExitCode: 1 }).verdict).toBe("infra_invalid");
		const thrown = attempt({
			status: "failed",
			checkFailed: true,
			errors: [{ ...crash, stack: "at x" }],
		});
		expect(run([thrown], { runnerExitCode: 1 }).verdict).toBe("agent_failed");
	});
	it("refuses a comparison's claim, and holds only a same-conditions regression against it", () => {
		const arm = (variant: string, host: string) =>
			attempt({
				testId: variant,
				claim: "claim",
				sample: { title: "claim", variant, arms: ["a", "b"], n: 1, flagAt: 1, subject: "prompt" },
				operations: [{ data: [{ record: record({ host }) }] }],
			});
		expect(run([arm("a", "claude"), arm("b", "codex")]).claimVerdicts?.claim).toBe(
			"conditions_unknown",
		);
	});
});

describe("each verdict's sentence", () => {
	const PREFIXES: [VerdictResult["verdict"], string][] = [
		["passed", "Passed"],
		["indicative", "Indicative:"],
		["agent_failed", "Failed: the agent"],
		["control_survived", "Failed: a control"],
		["infra_invalid", "No verdict: the host or runner"],
		["conditions_unknown", "No verdict: this run cannot show"],
		["vacuous", "No verdict: a test finished without earning"],
		["flaky", "No single verdict"],
		["skipped_only", "No verdict: no test ran"],
		["interrupted", "No verdict: the run was interrupted"],
		["listed", "Listed tests only"],
		["author_error", "No verdict: the test's own code failed"],
		["instrument_error", "No verdict: the runner and the recorded attempts disagree"],
	];
	for (const [verdict, prefix] of PREFIXES)
		it(`${verdict} reads as "${prefix}"`, () => {
			const result = {
				verdict,
				exitCode: 0,
				tests: {},
				claims: [],
				counts: { passed: 0, total: 1 },
			};
			expect(verdictSentence(result)).toStartWith(prefix);
		});
});

describe("what a comparison may let differ", () => {
	const fields: [NonNullable<ClaimSample["sample"]>["subject"], Record<string, unknown>][] = [
		["model", { requestedModel: "other" }],
		["prompt", { hashes: { ...record().hashes, prompt: "other" } }],
		["skills", { hashes: { ...record().hashes, skills: "other" } }],
		["tools", { hashes: { ...record().hashes, tools: "other" } }],
		["workspace", { hashes: { ...record().hashes, initialSnapshot: "other" } }],
	];
	const arms = (
		subject: NonNullable<ClaimSample["sample"]>["subject"],
		change: Record<string, unknown>,
	) => [
		sample("passed", { sample: { title: "claim", variant: "a", n: 1, subject } }),
		sample("failed", {
			sample: { title: "claim", variant: "b", n: 1, subject },
			record: record(change),
		}),
	];
	for (const [subject, change] of fields)
		it(`lets the ${subject} differ only when it is the subject`, () => {
			expect(only(buildClaims(arms(subject, change))).comparisonRefused).toBeUndefined();
			const other = subject === "prompt" ? "model" : "prompt";
			expect(only(buildClaims(arms(other, change))).comparisonRefused).toContain(
				"differs between runs",
			);
		});
});
