import { describe, expect, it } from "bun:test";
import {
	consumeCriterionOperations,
	markCriterionOperation,
	trackOperationOutput,
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
