import type { AgentMessage, AgentToolCall, LiveAgentEvent } from "./types.js";

export type { LiveAgentEvent };

export interface LiveNotifyState {
	toolCount: number;
	assistantChars: number;
}

export function createLiveNotifyState(): LiveNotifyState {
	return { toolCount: 0, assistantChars: 0 };
}

/** New tool calls and the latest assistant text since the last drain. */
export function drainLiveAgentEvents(
	acc: { toolCalls: AgentToolCall[]; agentMessages: AgentMessage[] },
	state: LiveNotifyState,
): LiveAgentEvent[] {
	const events: LiveAgentEvent[] = [];
	while (state.toolCount < acc.toolCalls.length) {
		const call = acc.toolCalls[state.toolCount];
		if (call) {
			events.push({ type: "tool", name: call.name, args: call.args });
		}
		state.toolCount += 1;
	}
	const last = [...acc.agentMessages].reverse().find((message) => message.role === "assistant");
	if (last && last.content.length !== state.assistantChars) {
		state.assistantChars = last.content.length;
		if (last.content.trim()) {
			events.push({ type: "text", text: last.content });
		}
	}
	return events;
}

export function emitLiveAgentEvents(
	acc: { toolCalls: AgentToolCall[]; agentMessages: AgentMessage[] },
	state: LiveNotifyState,
	onAgentEvent?: (event: LiveAgentEvent) => void,
): void {
	if (!onAgentEvent) {
		return;
	}
	for (const event of drainLiveAgentEvents(acc, state)) {
		onAgentEvent(event);
	}
}
