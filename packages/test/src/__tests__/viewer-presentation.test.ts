import { expect, it } from "bun:test";
import { storedValue } from "../sdk/stored-value.js";
import {
	conversationPlaceholder,
	describeShape,
	formatElapsed,
	median,
	preferredTestExecutionId,
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
