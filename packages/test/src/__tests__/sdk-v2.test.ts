import { describe, expect, it } from "bun:test";
import { claude, cursor, customAgent, openai } from "@post-print/agent-harness";
import { z } from "zod/v4";
import { parseEvaluation, serializeInput } from "../sdk/judge.js";
import { statistics } from "../sdk/metrics.js";

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
	it("validates structured judge output", () => {
		const schema = z.object({ correct: z.boolean() });
		expect(parseEvaluation('{"correct":true}', schema).correct).toBe(true);
		expect(() => parseEvaluation('{"correct":"yes"}', schema)).toThrow();
		expect(() => parseEvaluation("invalid JSON", schema)).toThrow();
	});
	it("rejects lossy judge input", () => {
		expect(() => serializeInput({ value: Number.NaN })).toThrow("non-finite");
		expect(serializeInput({ answer: "selected" })).toBe('{"answer":"selected"}');
	});
	it("does not silently drop runs with missing metrics", () => {
		const metric = statistics([10, undefined, 20]);
		expect(metric.available).toBe(false);
		expect(metric.count).toBe(3);
		expect(() => metric.mean).toThrow("Metric unavailable");
		expect(statistics([10, 20]).mean).toBe(15);
	});
});
