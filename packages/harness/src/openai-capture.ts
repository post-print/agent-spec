import {
	createTraceAccumulator,
	finalizeTraceAccumulator,
	mergeAgentUsage,
	normalizeAgentUsage,
	serializeToolResult,
	type TraceAccumulator,
} from "./capture.js";
import type { AgentTrace, AgentUsage } from "./types.js";

/** One JSONL line from `codex exec --json`. */
export interface OpenaiJsonlEvent {
	type?: string;
	item?: OpenaiThreadItem;
	usage?: unknown;
	error?: { message?: string } | string;
	message?: string;
}

export interface OpenaiThreadItem {
	id?: string;
	type?: string;
	text?: string;
	command?: string;
	aggregated_output?: string;
	exit_code?: number;
	changes?: Array<{ path?: string; kind?: string }>;
	path?: string;
	server?: string;
	tool?: string;
	arguments?: unknown;
	result?: unknown;
	status?: string;
}

export interface OpenaiTraceAccumulator extends TraceAccumulator {
	rawStatus?: string;
	resultError?: string;
	shellCommands: string[];
}

export function createOpenaiTraceAccumulator(): OpenaiTraceAccumulator {
	return {
		...createTraceAccumulator(),
		shellCommands: [],
	};
}

function normalizeOpenaiUsage(raw: unknown): AgentUsage | undefined {
	const camel = normalizeAgentUsage(raw);
	if (!raw || typeof raw !== "object") {
		return camel;
	}
	const record = raw as Record<string, unknown>;
	const snake: AgentUsage = {};
	if (typeof record.input_tokens === "number") {
		snake.inputTokens = record.input_tokens;
	}
	if (typeof record.output_tokens === "number") {
		snake.outputTokens = record.output_tokens;
	}
	if (typeof record.total_tokens === "number") {
		snake.totalTokens = record.total_tokens;
	}
	return mergeAgentUsage(camel, Object.keys(snake).length > 0 ? snake : undefined);
}

export function parseOpenaiJsonlLine(line: string): OpenaiJsonlEvent | undefined {
	const trimmed = line.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as OpenaiJsonlEvent;
	} catch {
		return undefined;
	}
}

function itemFromEvent(event: OpenaiJsonlEvent): OpenaiThreadItem | undefined {
	if (event.item && typeof event.item === "object") {
		return event.item;
	}
	const type = event.type ?? "";
	if (
		type === "agent_message" ||
		type === "command_execution" ||
		type === "file_change" ||
		type === "mcp_tool_call"
	) {
		return event as OpenaiThreadItem;
	}
	return undefined;
}

function toolNameForFileChange(kind: string | undefined): string {
	const normalized = (kind ?? "update").toLowerCase();
	if (normalized === "add" || normalized === "create") {
		return "Write";
	}
	if (normalized === "delete" || normalized === "remove") {
		return "Delete";
	}
	return "Edit";
}

function applyItem(acc: OpenaiTraceAccumulator, item: OpenaiThreadItem): void {
	const type = (item.type ?? "").toLowerCase();
	if (type === "agent_message" && item.text) {
		acc.agentMessages.push({
			role: "assistant",
			content: item.text,
			seq: acc.nextSeq++,
		});
		return;
	}
	if (type === "command_execution" && item.command) {
		acc.shellCommands.push(item.command);
		acc.toolCalls.push({
			name: "Shell",
			args: { command: item.command, cwd: item.path },
			result: item.aggregated_output,
			seq: acc.nextSeq++,
		});
		return;
	}
	if (type === "file_change") {
		const changes = item.changes?.length
			? item.changes
			: item.path
				? [{ path: item.path, kind: "update" }]
				: [];
		for (const change of changes) {
			if (!change.path) {
				continue;
			}
			acc.toolCalls.push({
				name: toolNameForFileChange(change.kind),
				args: { path: change.path },
				seq: acc.nextSeq++,
			});
		}
		return;
	}
	if (type === "mcp_tool_call" && (item.tool || item.server)) {
		const name =
			item.server && item.tool
				? `${item.server}:${item.tool}`
				: (item.tool ?? item.server ?? "mcp");
		acc.toolCalls.push({
			name,
			args: (item.arguments as Record<string, unknown> | undefined) ?? {},
			result: serializeToolResult(item.result),
			seq: acc.nextSeq++,
		});
	}
}

/** Fold one Codex JSONL event into the accumulator. */
export function accumulateOpenaiEvent(acc: OpenaiTraceAccumulator, event: OpenaiJsonlEvent): void {
	const type = event.type ?? "";
	if (type === "turn.completed" && event.usage) {
		acc.usage = mergeAgentUsage(acc.usage, normalizeOpenaiUsage(event.usage));
		return;
	}
	if (type === "turn.failed" || type === "error" || type === "thread.error") {
		acc.rawStatus = type;
		if (typeof event.error === "string") {
			acc.resultError = event.error;
		} else if (event.error?.message) {
			acc.resultError = event.error.message;
		} else if (event.message) {
			acc.resultError = event.message;
		}
		return;
	}
	if (type !== "item.completed" && type !== "item.started" && !itemFromEvent(event)) {
		return;
	}
	if (type === "item.started") {
		return;
	}
	const item = itemFromEvent(event);
	if (!item) {
		return;
	}
	applyItem(acc, item);
}

export function finalizeOpenaiTraceAccumulator(acc: OpenaiTraceAccumulator): AgentTrace {
	const trace = finalizeTraceAccumulator(acc);
	return {
		...trace,
		shellCommands: [...new Set([...trace.shellCommands, ...acc.shellCommands])],
		artifacts: {
			...trace.artifacts,
			...(acc.rawStatus ? { openaiRawStatus: acc.rawStatus } : {}),
			...(acc.resultError ? { openaiResultError: acc.resultError } : {}),
		},
	};
}

export function lastAssistantText(trace: AgentTrace): string {
	for (let index = trace.messages.length - 1; index >= 0; index--) {
		const message = trace.messages[index];
		if (message?.role === "assistant" && message.content.trim()) {
			return message.content.trim();
		}
	}
	return "";
}

export type { AgentUsage };
