// Held-out checks. The agent never sees this file: tests copy it into the run's final
// workspace copy after the agent finishes and run it there.
import { expect, test } from "bun:test";

import { taskStatus } from "../src/status.js";

test("hidden: any task with a completion timestamp is done", () => {
	expect(taskStatus({ id: "TASK-901", completedAt: "2026-10-01T09:30:00Z" })).toBe("done");
	expect(taskStatus({ id: "TASK-902", completedAt: "2025-01-31" })).toBe("done");
});

test("hidden: any task without a completion timestamp is open", () => {
	expect(taskStatus({ id: "TASK-903" })).toBe("open");
	expect(taskStatus({ id: "TASK-104" })).toBe("open");
});
