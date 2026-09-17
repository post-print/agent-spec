import { describe, expect, it } from "bun:test";
import { claude, cursor, customAgent, openai } from "@post-print/agent-harness";
import { parseGrade, validateCriteria } from "../sdk/judge.js";
import { statistics } from "../sdk/metrics.js";

const criteria = {
	correctness: { description: "Correct answer", scores: { 0: "Wrong", 2: "Correct" } },
};
const valid = {
	scores: { correctness: 2 },
	reasons: { correctness: "Supported by the guide" },
	evidence: {
		correctness: [{ source: "workspace", snapshot: "final", path: "PROJECT.md", line: 1 }],
	},
};
describe("v2 evaluation contracts", () => {
	it("creates immutable definitions without resolving credentials", () => {
		const agent = openai({
			auth: { type: "api-key", env: "NOT_SET_FOR_THIS_TEST" },
			context: { instructions: ["Inspect evidence"] },
		});
		expect(Object.isFrozen(agent.options.context?.instructions)).toBe(true);
		expect(agent.options.includeGlobalSkills).toBe(false);
	});
	it("excludes global skills by default for every agent definition", () => {
		const factories = [
			openai,
			claude,
			cursor,
			(options = {}) => customAgent({ adapter: "fake.mjs", options }),
		];
		for (const factory of factories) {
			expect(factory().options.includeGlobalSkills).toBe(false);
			expect(factory({ includeGlobalSkills: undefined }).options.includeGlobalSkills).toBe(false);
			expect(factory({ includeGlobalSkills: true }).options.includeGlobalSkills).toBe(true);
		}
	});
	it("rejects runtime closures inside worker configuration", () => {
		expect(() =>
			customAgent({ adapter: "fake.mjs", options: { callback: () => undefined } }),
		).toThrow("serializable");
	});
	it("requires two meaningful scores and a description", () => {
		expect(() => validateCriteria({ bad: { description: "", scores: { 0: "wrong" } } })).toThrow();
	});
	it("accepts declared scores with evidence", () => {
		expect(parseGrade(JSON.stringify(valid), criteria).scores.correctness).toBe(2);
	});
	it("rejects intermediate scores, missing reasons, evidence, and extra criteria", () => {
		for (const changed of [
			{ ...valid, scores: { correctness: 1 } },
			{ ...valid, reasons: {} },
			{ ...valid, evidence: { correctness: [] } },
			{ ...valid, scores: { correctness: 2, extra: 1 } },
		])
			expect(() => parseGrade(JSON.stringify(changed), criteria)).toThrow();
	});
	it("does not silently drop runs with missing metrics", () => {
		const metric = statistics([10, undefined, 20]);
		expect(metric.available).toBe(false);
		expect(metric.count).toBe(3);
		expect(() => metric.mean).toThrow("Metric unavailable");
		expect(statistics([10, 20]).mean).toBe(15);
	});
});
