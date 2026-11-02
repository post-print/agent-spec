import { expect, it } from "bun:test";
import { storedValue } from "../sdk/stored-value.js";
import type { RunVerdict } from "../sdk/verdict.js";
import {
	attemptRunStatus,
	conversationPlaceholder,
	describeShape,
	formatElapsed,
	formatRunDate,
	median,
	preferredTestExecutionId,
	runDisplayStatus,
	runStatusCounts,
	stripAnsi,
	testIdsBySeverity,
	testIntent,
	testRunStatus,
	unwrapShellCommand,
} from "../viewer/presentation.js";

it("viewer presentation › strips terminal color codes from assertion errors", () => {
	const error = "\u001b[31m+ Received\u001b[39m\n\u001b[2m  SEED-READY\u001b[22m";
	expect(stripAnsi(error)).toBe("+ Received\n  SEED-READY");
});

it("viewer presentation › distinguishes a pending conversation from a missing transcript", () => {
	expect(conversationPlaceholder("running")).toBe("Waiting for the first agent event…");
	expect(conversationPlaceholder("failed")).toBe("No conversation was captured.");
});

it("viewer presentation › reads a test's own status instead of the batch status", () => {
	const batch = {
		id: "batch",
		status: "failed",
		testIds: ["passing", "skipped", "unrecorded"],
		testStatuses: { passing: "passed", skipped: "skipped" } as const,
	};
	expect(testRunStatus(batch, "passing")).toBe("passed");
	expect(testRunStatus(batch, "skipped")).toBe("skipped");
	expect(testRunStatus(batch, "unrecorded")).toBe("failed");
	expect(testRunStatus({ id: "live", status: "running" }, "waiting")).toBe("queued");
	expect(testRunStatus({ id: "stopped", status: "interrupted" }, "any")).toBe("interrupted");
});

it("viewer presentation › opens the run where the test is active, then the newest run that ran it", () => {
	const runs = [
		{ id: "newest-skipped", status: "passed", testStatuses: { test: "skipped" } as const },
		{ id: "older-passed", status: "failed", testStatuses: { test: "passed" } as const },
	];
	expect(preferredTestExecutionId(runs, "test")).toBe("older-passed");
	expect(
		preferredTestExecutionId(
			[...runs, { id: "live", status: "running", testStatuses: { test: "running" } as const }],
			"test",
		),
	).toBe("live");
	expect(preferredTestExecutionId(runs.slice(0, 1), "test")).toBe("newest-skipped");
	expect(preferredTestExecutionId([], "test")).toBeUndefined();
});

it("viewer presentation › orders a run inbox by severity and counts each outcome", () => {
	const run = {
		id: "suite",
		status: "failed",
		testIds: ["a", "b", "c", "d"],
		testStatuses: { a: "passed", b: "skipped", c: "failed", d: "passed" } as const,
	};
	expect(testIdsBySeverity(run)).toEqual(["c", "a", "d", "b"]);
	expect([...runStatusCounts(run)]).toEqual([
		["failed", 1],
		["passed", 2],
		["skipped", 1],
	]);
});

it("viewer presentation › summarizes repeated runs with a median", () => {
	expect(median([])).toBeUndefined();
	expect(median([4])).toBe(4);
	expect(median([9, 1, 5])).toBe(5);
	expect(median([10, 2, 4, 8])).toBe(6);
});

it("viewer presentation › shows the command a host shell wrapper ran", () => {
	expect(unwrapShellCommand(`/bin/zsh -lc 'bun test'`)).toBe("bun test");
	expect(unwrapShellCommand(`bash -c "git diff -- src/status.ts"`)).toBe(
		"git diff -- src/status.ts",
	);
	expect(unwrapShellCommand("bun test")).toBe("bun test");
	expect(unwrapShellCommand(`/bin/zsh -lc 'a' && b'`)).toBe(`a' && b`);
});

it("stored values preserve useful command context while redacting private paths", () => {
	expect(
		storedValue({
			command: "cat /Users/example/private-workspace/seeded.txt",
			root: "/Users/example/private-workspace",
		}),
	).toEqual({ command: "cat <local-path>/seeded.txt", root: "<local-path>" });
});

it("viewer presentation › shows a description every test repeats once, as the suite's", () => {
	const shared = "Portable review conformance.";
	const first = { file: "a.spec.ts", title: ["review", "one"], description: shared };
	const second = { file: "a.spec.ts", title: ["review", "two"], description: shared };
	expect(testIntent(first, [first, second])).toEqual({ suite: shared, own: undefined });
	expect(testIntent(first, [first])).toEqual({ suite: undefined, own: shared });
});

it("viewer presentation › keeps a test's own description under a declared suite description", () => {
	const test = {
		file: "a.spec.ts",
		title: ["review", "one"],
		description: "Only this case.",
		suiteDescription: "Suite intent.",
	};
	expect(testIntent(test, [test])).toEqual({ suite: "Suite intent.", own: "Only this case." });
	expect(testIntent({ ...test, description: "Suite intent." }, [test])).toEqual({
		suite: "Suite intent.",
		own: undefined,
	});
});

it("viewer presentation › sizes a folded judge input by its shape", () => {
	expect(describeShape(["a", "b", "c"])).toBe("3 items");
	expect(describeShape({ one: 1 })).toBe("1 key");
	expect(describeShape("first\nsecond")).toBe("2 lines");
	expect(describeShape("x".repeat(2048))).toBe("2.0 KB");
	expect(describeShape(true)).toBe("true");
});

it("viewer presentation › reads run length in seconds, minutes, then hours", () => {
	expect(formatElapsed(-5)).toBe("0s");
	expect(formatElapsed(45_400)).toBe("45s");
	expect(formatElapsed(334_000)).toBe("5m 34s");
	expect(formatElapsed(3_725_000)).toBe("1h 02m");
});

function storedVerdict(tests: Record<string, RunVerdict>, verdict: RunVerdict = "passed") {
	return { verdict, exitCode: 0, tests, claims: [] };
}

it("viewer presentation › reads a good control and a flaky test from the stored verdict", () => {
	const run = {
		id: "stored",
		status: "failed",
		testIds: ["control", "flaky"],
		testStatuses: { control: "failed", flaky: "passed" } as const,
		verdict: storedVerdict({ control: "passed", flaky: "flaky" }, "flaky"),
	};
	expect(testRunStatus(run, "control")).toBe("passed");
	expect(testRunStatus(run, "flaky")).toBe("flaky");
	expect(runDisplayStatus(run)).toBe("flaky");
	expect(runDisplayStatus({ ...run, verdict: storedVerdict({ control: "passed" }) })).toBe(
		"passed",
	);
});

it("viewer presentation › names each stored verdict in one word a reader can act on", () => {
	const statusOf = (verdict: RunVerdict) =>
		testRunStatus(
			{
				id: "run",
				status: "failed",
				testStatuses: { t: "passed" },
				verdict: storedVerdict({ t: verdict }),
			},
			"t",
		);
	expect(statusOf("control_survived")).toBe("failed");
	expect(statusOf("agent_failed")).toBe("failed");
	expect(statusOf("infra_invalid")).toBe("no verdict");
	expect(statusOf("vacuous")).toBe("no verdict");
	expect(statusOf("conditions_unknown")).toBe("no verdict");
	expect(statusOf("skipped_only")).toBe("skipped");
	expect(statusOf("interrupted")).toBe("interrupted");
});

it("viewer presentation › keeps the recorded display when no verdict is stored", () => {
	const older = { id: "old", status: "failed", testStatuses: { control: "failed" } as const };
	expect(testRunStatus(older, "control")).toBe("failed");
	expect(runDisplayStatus({ ...older, testIds: ["control"] })).toBe("failed");
	expect(runDisplayStatus({ id: "live", status: "running" })).toBe("running");
	expect(runDisplayStatus({ id: "nothing-run", status: "interrupted" })).toBe("interrupted");
});

it("viewer presentation › an unreadable verdict is unknown, never the recorded pass", () => {
	const run = {
		id: "corrupt",
		status: "passed",
		testIds: ["test"],
		testStatuses: { test: "passed" } as const,
		verdictUnreadable: true,
	};
	expect(testRunStatus(run, "test")).toBe("unknown");
	expect(runDisplayStatus(run)).toBe("unknown");
	expect(
		attemptRunStatus({ ...run, attempts: [] }, { testId: "test", retry: 0, status: "passed" }),
	).toBe("unknown");
	expect(runDisplayStatus({ id: "unknown-run", status: "unknown" })).toBe("unknown");
});

it("viewer presentation › a stored verdict that does not name a run test does not fall back to pass", () => {
	const run = {
		id: "stored",
		status: "passed",
		testStatuses: { lost: "passed", notRun: "skipped" } as const,
		verdict: storedVerdict({}),
	};
	expect(testRunStatus(run, "lost")).toBe("unknown");
	expect(testRunStatus(run, "notRun")).toBe("skipped");
});

it("viewer presentation › reads a sampled test from the verdict stored for its claim", () => {
	const claim = "default › file › sampled";
	const statusOf = (claimVerdicts?: Record<string, RunVerdict>) =>
		testRunStatus(
			{
				id: "sampled",
				status: "failed",
				testStatuses: { repeat: "failed" },
				testClaims: { repeat: claim },
				verdict: { verdict: "indicative", exitCode: 3, tests: {}, claims: [], claimVerdicts },
			} as never,
			"repeat",
		);
	expect(statusOf({ [claim]: "indicative" })).toBe("indicative");
	expect(statusOf({ [claim]: "passed" })).toBe("passed");
	expect(statusOf({ [claim]: "agent_failed" })).toBe("failed");
	expect(statusOf({ [claim]: "control_survived" })).toBe("failed");
	expect(statusOf({ [claim]: "infra_invalid" })).toBe("no verdict");
	expect(statusOf({ [claim]: "conditions_unknown" })).toBe("no verdict");
	expect(statusOf()).toBe("unknown");
});

it("viewer presentation › an attempt reads the verdict only on the test's last retry", () => {
	const first = { testId: "flaky", retry: 0, status: "failed" };
	const last = { testId: "flaky", retry: 1, status: "passed" };
	const control = { testId: "control", retry: 0, status: "failed" };
	const run = {
		id: "stored",
		status: "failed",
		attempts: [first, last, control],
		verdict: storedVerdict({ flaky: "flaky", control: "passed" }),
	};
	expect(attemptRunStatus(run, first)).toBe("failed");
	expect(attemptRunStatus(run, last)).toBe("flaky");
	expect(attemptRunStatus(run, control)).toBe("passed");
	expect(attemptRunStatus({ id: "old", status: "failed", attempts: [control] }, control)).toBe(
		"failed",
	);
});

it("viewer presentation › an unreadable run date does not throw", () => {
	expect(formatRunDate("")).toBe("Unknown date");
	expect(formatRunDate("not a date")).toBe("Unknown date");
});

it("viewer presentation › failed and no-verdict tests sort before passes", () => {
	const run = {
		id: "stored",
		status: "failed",
		testIds: ["passes", "flaky", "broken", "failed"],
		verdict: storedVerdict({
			passes: "passed",
			flaky: "flaky",
			broken: "infra_invalid",
			failed: "agent_failed",
		}),
	};
	expect(testIdsBySeverity(run)).toEqual(["failed", "broken", "flaky", "passes"]);
});
