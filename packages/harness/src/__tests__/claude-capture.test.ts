import { describe, expect, it } from "vitest";

import {
	accumulateClaudeEvent,
	buildTraceFromClaudeEvents,
	type ClaudeStreamEvent,
	createClaudeTraceAccumulator,
	finalizeClaudeTraceAccumulator,
	normalizeClaudeToolArgs,
	normalizeClaudeUsage,
	parseClaudeNdjsonLine,
} from "../claude-capture.js";
import { isUserInputTool } from "../run-guards.js";

const ASSISTANT_WITH_BASH: ClaudeStreamEvent = {
	type: "assistant",
	message: {
		role: "assistant",
		content: [
			{ type: "text", text: "Running ls.\n" },
			{
				type: "tool_use",
				id: "toolu_1",
				name: "Bash",
				input: { command: "bun run test:sandbox-safe" },
			},
		],
	},
};

const TOOL_RESULT: ClaudeStreamEvent = {
	type: "user",
	message: {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "toolu_1",
				content: "ok",
			},
		],
	},
};

const RESULT_SUCCESS: ClaudeStreamEvent = {
	type: "result",
	subtype: "success",
	result: "done",
	usage: {
		input_tokens: 10,
		output_tokens: 5,
		cache_read_input_tokens: 2,
	},
};

describe("parseClaudeNdjsonLine", () => {
	it("parses valid JSON lines and skips blanks/invalid", () => {
		expect(parseClaudeNdjsonLine("")).toBeUndefined();
		expect(parseClaudeNdjsonLine("not-json")).toBeUndefined();
		expect(parseClaudeNdjsonLine('{"type":"result","subtype":"success"}')).toEqual({
			type: "result",
			subtype: "success",
		});
	});
});

describe("normalizeClaudeUsage", () => {
	it("maps snake_case Anthropic usage fields", () => {
		expect(
			normalizeClaudeUsage({
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 2,
				cache_creation_input_tokens: 1,
			}),
		).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
			totalTokens: 18,
		});
	});
});

describe("normalizeClaudeToolArgs", () => {
	it("exposes command for Bash tools", () => {
		expect(normalizeClaudeToolArgs("Bash", { cmd: "ls -la" })).toEqual({
			cmd: "ls -la",
			command: "ls -la",
		});
	});
});

describe("buildTraceFromClaudeEvents", () => {
	it("maps assistant text, Bash tool_use/result, and usage", () => {
		const trace = buildTraceFromClaudeEvents([ASSISTANT_WITH_BASH, TOOL_RESULT, RESULT_SUCCESS]);
		expect(trace.messages.some((m) => m.content.includes("Running ls"))).toBe(true);
		expect(trace.toolCalls).toEqual([
			expect.objectContaining({
				name: "Bash",
				args: { command: "bun run test:sandbox-safe" },
				result: "ok",
				seq: expect.any(Number),
			}),
		]);
		expect(trace.shellCommands).toContain("bun run test:sandbox-safe");
		expect(trace.usage).toMatchObject({
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 2,
		});
		expect(trace.artifacts.claudeRawStatus).toBe("success");
	});

	it("records AskUserQuestion tool calls for fail-fast detection", () => {
		const trace = buildTraceFromClaudeEvents([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_q",
							name: "AskUserQuestion",
							input: { question: "Which option?" },
						},
					],
				},
			},
		]);
		expect(trace.toolCalls[0]?.name).toBe("AskUserQuestion");
		expect(isUserInputTool(trace.toolCalls[0]?.name ?? "")).toBe(true);
	});

	it("coalesces stream_event text deltas", () => {
		const acc = createClaudeTraceAccumulator();
		accumulateClaudeEvent(acc, {
			type: "stream_event",
			event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
		});
		accumulateClaudeEvent(acc, {
			type: "stream_event",
			event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
		});
		const trace = finalizeClaudeTraceAccumulator(acc);
		expect(trace.messages).toEqual([
			expect.objectContaining({ role: "assistant", content: "Hello" }),
		]);
	});
});

describe("isUserInputTool Claude names", () => {
	it("matches AskUserQuestion variants", () => {
		expect(isUserInputTool("AskUserQuestion")).toBe(true);
		expect(isUserInputTool("ask_user_question")).toBe(true);
	});
});
