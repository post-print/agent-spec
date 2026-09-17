import { expect, it } from "bun:test";

import {
	accumulateOpenaiEvent,
	createOpenaiTraceAccumulator,
	finalizeOpenaiTraceAccumulator,
	parseOpenaiJsonlLine,
} from "../openai-capture.js";

it("openai-capture › maps Codex JSONL items onto the host-agnostic trace", () => {
	const acc = createOpenaiTraceAccumulator();
	const lines = [
		`{"type":"item.completed","item":{"type":"agent_message","text":"I will list files."}}`,
		`{"type":"item.completed","item":{"type":"command_execution","command":"ls AGENTS.md","aggregated_output":"AGENTS.md","exit_code":0}}`,
		`{"type":"item.completed","item":{"type":"file_change","changes":[{"path":".agents/skills/probe/SKILL.md","kind":"update"}]}}`,
		`{"type":"item.completed","item":{"type":"mcp_tool_call","server":"echo","tool":"ping","arguments":{"text":"ok"},"result":"ok"}}`,
		`{"type":"turn.completed","usage":{"input_tokens":11,"output_tokens":4}}`,
	];
	for (const line of lines) {
		const event = parseOpenaiJsonlLine(line);
		expect(event).toBeDefined();
		if (event) {
			accumulateOpenaiEvent(acc, event);
		}
	}
	const trace = finalizeOpenaiTraceAccumulator(acc);
	expect(trace.messages.map((message) => message.content)).toEqual(["I will list files."]);
	expect(trace.toolCalls.map((call) => call.name)).toEqual(["Shell", "Edit", "echo:ping"]);
	expect(trace.shellCommands).toContain("ls AGENTS.md");
	expect(trace.toolCalls[0]).toMatchObject({ exitCode: 0, succeeded: true });
	expect(trace.toolCalls.some((call) => call.args?.path === ".agents/skills/probe/SKILL.md")).toBe(
		true,
	);
	expect(trace.usage?.inputTokens).toBe(11);
	expect(trace.usage?.outputTokens).toBe(4);
	expect(trace.usage?.totalTokens).toBe(15);
});

it("openai-capture › records a failed command from its exit code", () => {
	const acc = createOpenaiTraceAccumulator();
	accumulateOpenaiEvent(acc, {
		type: "item.completed",
		item: {
			type: "command_execution",
			command: "bun test",
			aggregated_output: "1 test failed",
			exit_code: 1,
		},
	});
	expect(finalizeOpenaiTraceAccumulator(acc).toolCalls[0]).toMatchObject({
		exitCode: 1,
		succeeded: false,
	});
});

it("openai-capture › maps Codex cache and reasoning fields and fills totalTokens", () => {
	const acc = createOpenaiTraceAccumulator();
	accumulateOpenaiEvent(acc, {
		type: "turn.completed",
		usage: {
			input_tokens: 100,
			cached_input_tokens: 80,
			cache_write_input_tokens: 5,
			output_tokens: 20,
			reasoning_output_tokens: 7,
		},
	});
	const trace = finalizeOpenaiTraceAccumulator(acc);
	expect(trace.usage).toEqual({
		inputTokens: 100,
		outputTokens: 20,
		totalTokens: 120,
		cacheReadTokens: 80,
		cacheWriteTokens: 5,
		reasoningTokens: 7,
	});
});
