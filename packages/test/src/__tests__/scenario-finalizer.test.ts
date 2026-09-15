import { describe, expect, it } from "bun:test";

import { finalizeScenarioResult } from "../scenario-finalizer.js";

const scenario = {
	name: "answer",
	description: "  Answers directly.  ",
	prompt: "Say hello.",
	rubric: { must: ["hello"] },
};

const trace = {
	messages: [{ role: "assistant" as const, content: "hello" }],
	toolCalls: [],
	shellCommands: [],
	artifacts: {},
	usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
};

describe("finalizeScenarioResult", () => {
	it("finalizes ordinary, failed, judged, and retried results at one boundary", () => {
		const ordinary = finalizeScenarioResult({
			suite: "smoke",
			scenario,
			failures: [],
			durationMs: 12,
			trace,
		});
		expect(ordinary).toMatchObject({
			suite: "smoke",
			scenario: "answer",
			description: "Answers directly.",
			passed: true,
			agentUsage: { totalTokens: 6 },
		});
		expect(ordinary.story?.criteria).toContain('reply includes "hello"');

		const failed = finalizeScenarioResult({
			suite: "smoke",
			scenario,
			failures: [{ matcher: "must", message: "missing hello", category: "rubric_miss" }],
			durationMs: 15,
			trace,
			attempts: 3,
			judgeVerdicts: [
				{
					id: "clear",
					question: "Was it clear?",
					pass: false,
					rationale: "No.",
					usage: { totalTokens: 5 },
				},
			],
		});
		expect(failed).toMatchObject({
			passed: false,
			attempts: 3,
			judgeUsage: { totalTokens: 5 },
			usage: { total: { totalTokens: 11 } },
		});
		expect(failed.story?.verdict.join(" ")).toContain("missing hello");
	});

	it("finalizes compare evidence and story from the same input", () => {
		const arms = [
			{ id: "a", label: "control", prompt: "A", trace, passed: true, failures: [] },
			{ id: "b", label: "candidate", prompt: "B", trace, passed: true, failures: [] },
		];
		const compare = { arms, a: arms[0], b: arms[1] };
		const result = finalizeScenarioResult({
			suite: "compare",
			scenario,
			failures: [],
			durationMs: 20,
			trace,
			compare,
			storyCompare: { arms },
		});

		expect(result.compare).toBe(compare);
		expect(result.passed).toBe(true);
		expect(result.story?.criteria.join(" ")).toContain("compare control vs candidate");
	});
});
