import { describe, expect, it } from "vitest";
import type { AgentSuiteFile } from "../types.js";
import { validateSuiteFile } from "../validate-suite.js";

describe("validate-suite", () => {
	it("rejects invalid tier enum", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					rubric: { tier: "MEDIUM" as unknown as "medium" },
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "rubric.tier")).toBe(true);
	});

	it("requires seedPatch when seedStageOnly is set", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					seedStageOnly: true,
					rubric: {},
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "seedStageOnly")).toBe(true);
	});
});
