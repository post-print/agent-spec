import { describe, expect, it } from "bun:test";
import {
	consumeCriterionOperations,
	markCriterionOperation,
	noteCheck,
	trackOperationOutput,
	wasChecked,
} from "../sdk/criterion-provenance.js";

describe("criterion provenance", () => {
	it("tracks the operations whose outputs feed the next assertion", () => {
		const first = trackOperationOutput({ id: "run-1", output: "NO" });
		const second = trackOperationOutput({ id: "run-2", output: "YES" });
		expect([first.output, second.output]).toEqual(["NO", "YES"]);
		expect(consumeCriterionOperations()).toEqual(["run-1", "run-2"]);
	});

	it("clears unused provenance at the next microtask", async () => {
		markCriterionOperation("run-1");
		await Promise.resolve();
		expect(consumeCriterionOperations()).toEqual([]);
	});
});

describe("checks on an operation's evidence", () => {
	const run = (id: string) =>
		trackOperationOutput({ id, output: "done", prompt: "task", workspace: { changedPaths: [] } });
	it("a check after its evidence was read counts, even across an await", async () => {
		const tracked = run("read-then-checked");
		const changed = tracked.workspace.changedPaths;
		await Promise.resolve();
		noteCheck(undefined);
		expect(changed).toEqual([]);
		expect(wasChecked("read-then-checked")).toBe(true);
	});
	it("a check before any evidence was read does not count", () => {
		const tracked = run("checked-too-early");
		noteCheck(undefined);
		expect(tracked.output).toBe("done");
		expect(wasChecked("checked-too-early")).toBe(false);
	});
	it("reading the test's own prompt is not reading evidence", () => {
		const tracked = run("prompt-only");
		expect(tracked.prompt).toBe("task");
		noteCheck(undefined);
		expect(wasChecked("prompt-only")).toBe(false);
	});
	it("a check handed the operation itself counts", () => {
		run("handed");
		noteCheck("handed");
		expect(wasChecked("handed")).toBe(true);
	});
	it("serializing the run reads every evidence field it holds", () => {
		const tracked = run("serialized");
		expect(JSON.parse(JSON.stringify(tracked))).toMatchObject({ output: "done" });
		noteCheck(undefined);
		expect(wasChecked("serialized")).toBe(true);
	});
});
