import { describe, expect, it } from "bun:test";

import {
	accumulateOpenaiEvent,
	createOpenaiTraceAccumulator,
	finalizeOpenaiTraceAccumulator,
	parseOpenaiJsonlLine,
} from "../openai-capture.js";

describe("openai-capture", () => {
	it("maps Codex JSONL items onto the host-agnostic trace", () => {
		const acc = createOpenaiTraceAccumulator();
		const lines = [
			`{"type":"item.completed","item":{"type":"agent_message","text":"I will list files."}}`,
			`{"type":"item.completed","item":{"type":"command_execution","command":"ls AGENTS.md","aggregated_output":"AGENTS.md"}}`,
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
		expect(
			trace.toolCalls.some((call) => call.args?.path === ".agents/skills/probe/SKILL.md"),
		).toBe(true);
		expect(trace.usage?.inputTokens).toBe(11);
	});
});
