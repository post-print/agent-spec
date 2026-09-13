import { describe, expect, it } from "bun:test";

import { createLiveNotifyState, drainLiveAgentEvents } from "../live-agent-event.js";

describe("drainLiveAgentEvents", () => {
	it("emits each new tool call once", () => {
		const state = createLiveNotifyState();
		const acc = {
			toolCalls: [{ name: "Read", args: { path: "SKILL.md" } }],
			agentMessages: [] as { role: "assistant"; content: string }[],
		};
		expect(drainLiveAgentEvents(acc, state)).toEqual([
			{ type: "tool", name: "Read", args: { path: "SKILL.md" } },
		]);
		expect(drainLiveAgentEvents(acc, state)).toEqual([]);
	});

	it("emits updated assistant text", () => {
		const state = createLiveNotifyState();
		const acc = {
			toolCalls: [],
			agentMessages: [{ role: "assistant" as const, content: "hi" }],
		};
		expect(drainLiveAgentEvents(acc, state)).toEqual([{ type: "text", text: "hi" }]);
		acc.agentMessages[0] = { role: "assistant", content: "hi there" };
		expect(drainLiveAgentEvents(acc, state)).toEqual([{ type: "text", text: "hi there" }]);
	});
});
