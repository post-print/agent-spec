import { expect, it } from "bun:test";
import { storedValue } from "../sdk/stored-value.js";
import {
	conversationPlaceholder,
	preferredTestExecutionId,
	runStatusCounts,
	stripAnsi,
	testIdsBySeverity,
	testRunStatus,
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

it("stored values preserve useful command context while redacting private paths", () => {
	expect(
		storedValue({
			command: "cat /Users/example/private-workspace/seeded.txt",
			root: "/Users/example/private-workspace",
		}),
	).toEqual({ command: "cat <local-path>/seeded.txt", root: "<local-path>" });
});
