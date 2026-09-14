import { expect, test } from "bun:test";

import { taskStatus } from "../src/status.js";

test("a completed task is done", () => {
	expect(taskStatus({ id: "TASK-104", completedAt: "2026-09-14" })).toBe("done");
});

test("an incomplete task is open", () => {
	expect(taskStatus({ id: "TASK-105" })).toBe("open");
});
