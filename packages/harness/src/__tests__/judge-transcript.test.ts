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
		const result = await judgeTrace(
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
		expect(prompt).toContain("exact, contiguous excerpts");
		expect(prompt).toContain("Do not paraphrase, summarize, infer, or invent evidence.");
		expect(result.verdicts[0]?.prompt).toBe(prompt);
		expect(result.verdicts[0]?.response).toContain('"verdict":"yes"');
		expect(result.verdicts[0]?.evidence).toEqual(["mcp echo ok"]);
	});

	it("passes named read-only workspace evidence to a single-arm classifier", async () => {
		let received:
			| { cwd: string; workspaces?: readonly { name: string; path: string }[] }
			| undefined;
		const { judgeTrace } = await import("../judge.js");
		const result = await judgeTrace(
			{ messages: [], toolCalls: [], shellCommands: [], artifacts: {} },
			[{ id: "files", question: "Is the initialized file present?" }],
			{
				cwd: "/tmp/original",
				host: "openai",
				apiKey: "test-key",
				workspaces: [{ name: "consumer", path: "/tmp/read-only-consumer" }],
				classify: async (options) => {
					received = options;
					return {
						status: "completed",
						text: '{"verdict":"yes","evidence":[],"rationale":"file exists"}',
					};
				},
			},
		);
		expect(received?.cwd).toBe("/tmp/read-only-consumer");
		expect(received?.workspaces).toEqual([{ name: "consumer", path: "/tmp/read-only-consumer" }]);
		expect(result.verdicts[0]?.workspaceEvidence).toEqual(["consumer"]);
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

	it("reports cumulative judge text while a criterion is being scored", async () => {
		const { judgeTrace } = await import("../judge.js");
		const events: Array<{ type: string; text?: string }> = [];
		await judgeTrace(
			{
				messages: [{ role: "assistant", content: "hello" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
			},
			[{ id: "quality", question: "Was the reply useful?" }],
			{
				cwd: process.cwd(),
				host: "openai",
				apiKey: "openai-test-key",
				classify: async ({ onText }) => {
					onText?.('{"verdict":"yes"');
					onText?.('{"verdict":"yes","evidence":["hello"],"rationale":"useful"}');
					return {
						status: "completed",
						text: '{"verdict":"yes","evidence":["hello"],"rationale":"useful"}',
					};
				},
				onEvent: (event) => events.push(event),
			},
		);

		expect(events.map((event) => event.type)).toEqual([
			"criterion_started",
			"text",
			"text",
			"criterion_finished",
		]);
		expect(events[1]?.text).toBe('{"verdict":"yes"');
		expect(events[2]?.text).toContain('"rationale":"useful"');
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
				workspaces: [
					{ name: "skeleton-clean", path: "/tmp/judge/arm-1" },
					{ name: "no-skill-clean", path: "/tmp/judge/arm-2" },
				],
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
		expect(prompt).toContain("skeleton-clean: /tmp/judge/arm-1");
		expect(prompt).toContain("no-skill-clean: /tmp/judge/arm-2");
		expect(prompt).toContain("Did the two arms reply with different words?");
	});

	it("sends every named arm transcript without asking for one winner", async () => {
		let prompt = "";
		const { judgeCompareTraces } = await import("../judge.js");
		const emptyTrace = {
			messages: [] as { role: "assistant"; content: string }[],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const result = await judgeCompareTraces(
			{
				arms: [
					{
						label: "skeleton clean",
						trace: { ...emptyTrace, messages: [{ role: "assistant", content: "skel-clean-ok" }] },
					},
					{
						label: "no skill clean",
						trace: { ...emptyTrace, messages: [{ role: "assistant", content: "none-clean-ok" }] },
					},
					{
						label: "skeleton messy",
						trace: { ...emptyTrace, messages: [{ role: "assistant", content: "skel-messy-ok" }] },
					},
					{
						label: "no skill messy",
						trace: { ...emptyTrace, messages: [{ role: "assistant", content: "none-messy-ok" }] },
					},
				],
			},
			[{ id: "shared", question: "Did each arm answer from the catalog?" }],
			{
				cwd: process.cwd(),
				host: "openai",
				apiKey: "openai-test-key",
				classify: async (options) => {
					prompt = options.prompt;
					return {
						status: "completed",
						text: '{"verdict":"yes","evidence":["skel-clean-ok"],"rationale":"all arms answered"}',
					};
				},
			},
		);
		expect(result.skipped).toBe(false);
		expect(prompt).toContain("Arm skeleton clean:");
		expect(prompt).toContain("Arm no skill messy:");
		expect(prompt).toContain("Do not pick a single winner unless the criterion asks for one.");
		expect(prompt).not.toContain("Arm A (");
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
