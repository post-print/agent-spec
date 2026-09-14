import { describe, expect, it } from "bun:test";

import { formatTraceForJudge, skillInvokeJudgeCriteria } from "../judge.js";
import type { AgentTrace } from "../types.js";

describe("formatTraceForJudge", () => {
	it("includes tool names, args, and results", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "I will echo the text." }],
			toolCalls: [
				{
					name: "echo",
					args: { text: "mcp echo ok" },
					result: "mcp echo ok",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		const text = formatTraceForJudge(trace);
		expect(text).toContain("Tool calls:");
		expect(text).toContain("echo");
		expect(text).toContain("mcp echo ok");
		expect(text).toContain("result:");
	});

	it("interleaves messages and tools by seq", () => {
		const text = formatTraceForJudge({
			messages: [{ role: "assistant", content: "FOLLOWED_SKILL_REPLY", seq: 2 }],
			toolCalls: [
				{
					name: "Read",
					args: { path: ".agents/skills/agent-test-depth/SKILL.md" },
					result: "skill body",
					seq: 1,
				},
			],
			shellCommands: [],
			artifacts: {},
		});
		expect(text.indexOf("Read")).toBeGreaterThan(-1);
		expect(text.indexOf("Read")).toBeLessThan(text.indexOf("FOLLOWED_SKILL_REPLY"));
	});
});

describe("judgeTrace host auth", () => {
	it("tells the classifier to score outcomes from tool results", async () => {
		let prompt = "";
		const { judgeTrace } = await import("../judge.js");
		await judgeTrace(
			{
				messages: [{ role: "assistant", content: "done" }],
				toolCalls: [
					{
						name: "echo",
						args: { text: "ping" },
						result: "mcp echo ok",
					},
				],
				shellCommands: [],
				artifacts: {},
			},
			[{ id: "out", question: "Did the echo tool return mcp echo ok?" }],
			{
				cwd: process.cwd(),
				host: "openai",
				apiKey: "openai-test-key",
				classify: async (options) => {
					prompt = options.prompt;
					return {
						status: "completed",
						text: '{"verdict":"yes","evidence":["mcp echo ok"],"rationale":"tool result"}',
					};
				},
			},
		);
		expect(prompt).toContain("Did the echo tool return mcp echo ok?");
		expect(prompt).toContain("result:");
		expect(prompt).toContain("mcp echo ok");
		expect(prompt).toMatch(/tool results/i);
	});

	it("scores with an injected classifier on the OpenAI host", async () => {
		const prior = process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_API_KEY;
		try {
			const { judgeTrace } = await import("../judge.js");
			const result = await judgeTrace(
				{
					messages: [{ role: "assistant", content: "hello" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
				[{ id: "c1", question: "Did the agent greet?" }],
				{
					cwd: process.cwd(),
					host: "openai",
					apiKey: "openai-test-key",
					classify: async () => ({
						status: "completed",
						text: '{"verdict":"yes","evidence":["hello"],"rationale":"greeted"}',
					}),
				},
			);
			expect(result.skipped).toBe(false);
			expect(result.verdicts[0]?.pass).toBe(true);
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
		}
	});
});

describe("judgeCompareTraces", () => {
	it("sends both arm transcripts to the classifier", async () => {
		let prompt = "";
		const { judgeCompareTraces } = await import("../judge.js");
		const result = await judgeCompareTraces(
			{
				aLabel: "alpha",
				a: {
					messages: [{ role: "assistant", content: "alpha-compare-a7c1" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
				bLabel: "beta",
				b: {
					messages: [{ role: "assistant", content: "beta-compare-b3e9" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
			},
			[{ id: "distinct-words", question: "Did the two arms reply with different words?" }],
			{
				cwd: process.cwd(),
				host: "openai",
				apiKey: "openai-test-key",
				classify: async (options) => {
					prompt = options.prompt;
					return {
						status: "completed",
						text: '{"verdict":"yes","evidence":["alpha-compare-a7c1"],"rationale":"words differ"}',
					};
				},
			},
		);
		expect(result.skipped).toBe(false);
		expect(result.verdicts[0]?.pass).toBe(true);
		expect(prompt).toContain("Arm A (alpha)");
		expect(prompt).toContain("Arm B (beta)");
		expect(prompt).toContain("alpha-compare-a7c1");
		expect(prompt).toContain("beta-compare-b3e9");
		expect(prompt).toContain("Did the two arms reply with different words?");
	});
});

describe("skillInvokeJudgeCriteria", () => {
	it("asks whether the skill was followed, not merely named", () => {
		const criteria = skillInvokeJudgeCriteria(["probe"]);
		expect(criteria).toHaveLength(1);
		expect(criteria[0]?.id).toBe("invoke-skill:probe");
		expect(criteria[0]?.question).toContain("probe");
		expect(criteria[0]?.question).toContain("Naming the skill");
		expect(criteria[0]?.question).toContain("confirmatory SKILL.md read");
	});
});
