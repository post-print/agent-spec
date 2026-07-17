import {
	createTraceAccumulator,
	finalizeTraceAccumulator,
	mergeAgentUsage,
	normalizeAgentUsage,
	serializeToolResult,
	type TraceAccumulator,
} from "./capture.js";
import type { AgentToolCall, AgentTrace, AgentUsage } from "./types.js";

/** One NDJSON line from `claude -p --output-format stream-json`. */
export interface ClaudeStreamEvent {
	type?: string;
	subtype?: string;
	message?: {
		role?: string;
		content?: ClaudeContentBlock[];
	};
	event?: {
		type?: string;
		delta?: { type?: string; text?: string };
	};
	result?: string;
	is_error?: boolean;
	usage?: unknown;
	error?: string;
	errors?: string[];
}

export interface ClaudeContentBlock {
	type?: string;
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
}

export interface ClaudeTraceAccumulator extends TraceAccumulator {
	/** Pending tool_use ids awaiting tool_result. */
	toolCallIndexByToolUseId: Map<string, number>;
	/** Terminal result event fields. */
	resultText?: string;
	resultIsError?: boolean;
	resultError?: string;
	/** Unnormalized CLI exit / result subtype. */
	rawStatus?: string;
}

export function createClaudeTraceAccumulator(): ClaudeTraceAccumulator {
	return {
		...createTraceAccumulator(),
		toolCallIndexByToolUseId: new Map(),
	};
}

/** Map Anthropic snake_case usage into AgentUsage. */
export function normalizeClaudeUsage(raw: unknown): AgentUsage | undefined {
	const camel = normalizeAgentUsage(raw);
	if (!raw || typeof raw !== "object") {
		return camel;
	}
	const record = raw as Record<string, unknown>;
	const snake: AgentUsage = {};
	const input = record.input_tokens;
	const output = record.output_tokens;
	const cacheRead = record.cache_read_input_tokens;
	const cacheWrite = record.cache_creation_input_tokens;
	if (typeof input === "number" && Number.isFinite(input)) {
		snake.inputTokens = input;
	}
	if (typeof output === "number" && Number.isFinite(output)) {
		snake.outputTokens = output;
	}
	if (typeof cacheRead === "number" && Number.isFinite(cacheRead)) {
		snake.cacheReadTokens = cacheRead;
	}
	if (typeof cacheWrite === "number" && Number.isFinite(cacheWrite)) {
		snake.cacheWriteTokens = cacheWrite;
	}
	if (
		snake.inputTokens !== undefined ||
		snake.outputTokens !== undefined ||
		snake.cacheReadTokens !== undefined ||
		snake.cacheWriteTokens !== undefined
	) {
		const total =
			(snake.inputTokens ?? 0) +
			(snake.outputTokens ?? 0) +
			(snake.cacheReadTokens ?? 0) +
			(snake.cacheWriteTokens ?? 0);
		if (total > 0 && snake.totalTokens === undefined) {
			snake.totalTokens = total;
		}
	}
	return mergeAgentUsage(camel, Object.keys(snake).length > 0 ? snake : undefined);
}

function asArgs(input: unknown): Record<string, unknown> | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (input && typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}
	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return { command: input };
		}
		return { value: input };
	}
	return { value: input };
}

/** Ensure Bash/shell tool args expose `command` for extractShellCommandsFromToolCalls. */
export function normalizeClaudeToolArgs(
	name: string,
	args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!args) {
		return undefined;
	}
	if (/^(bash|shell)$/i.test(name) && typeof args.command !== "string") {
		const cmd = args.cmd ?? args.script ?? args.input;
		if (typeof cmd === "string") {
			return { ...args, command: cmd };
		}
	}
	return args;
}

function pushAssistantText(acc: ClaudeTraceAccumulator, text: string): void {
	if (!text) {
		return;
	}
	const last = acc.agentMessages.at(-1);
	if (last?.role === "assistant" && last.seq === acc.nextSeq - 1) {
		last.content += text;
	} else {
		acc.agentMessages.push({ role: "assistant", content: text, seq: acc.nextSeq++ });
	}
	acc.inferenceChunks.push(text);
	acc.textChunks.push(text);
	if (!acc.hasSeenTool) {
		acc.preToolAssistantChunks.push(text);
	}
}

function pushToolCall(
	acc: ClaudeTraceAccumulator,
	toolCall: AgentToolCall,
	toolUseId?: string,
): void {
	acc.hasSeenTool = true;
	const existingIndex =
		toolUseId !== undefined ? acc.toolCallIndexByToolUseId.get(toolUseId) : undefined;
	if (existingIndex !== undefined) {
		const previous = acc.toolCalls[existingIndex];
		if (previous) {
			acc.toolCalls[existingIndex] = {
				...previous,
				name: toolCall.name,
				args: toolCall.args ?? previous.args,
				result: toolCall.result ?? previous.result,
			};
		}
		return;
	}
	const index = acc.toolCalls.length;
	acc.toolCalls.push({ ...toolCall, seq: acc.nextSeq++ });
	if (toolUseId !== undefined) {
		acc.toolCallIndexByToolUseId.set(toolUseId, index);
	}
}

function handleContentBlocks(acc: ClaudeTraceAccumulator, blocks: ClaudeContentBlock[]): void {
	for (const block of blocks) {
		const type = block.type ?? "";
		if (type === "text" && typeof block.text === "string") {
			pushAssistantText(acc, block.text);
			continue;
		}
		if (type === "tool_use" && typeof block.name === "string") {
			const args = normalizeClaudeToolArgs(block.name, asArgs(block.input));
			pushToolCall(
				acc,
				{
					name: block.name,
					...(args ? { args } : {}),
				},
				typeof block.id === "string" ? block.id : undefined,
			);
			continue;
		}
		if (type === "tool_result") {
			const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
			const result = serializeToolResult(block.content);
			if (toolUseId !== undefined) {
				const existingIndex = acc.toolCallIndexByToolUseId.get(toolUseId);
				if (existingIndex !== undefined) {
					const previous = acc.toolCalls[existingIndex];
					if (previous && result !== undefined) {
						acc.toolCalls[existingIndex] = { ...previous, result };
					}
					continue;
				}
			}
			if (result !== undefined) {
				acc.toolOutputChunks.push(result);
			}
		}
	}
}

/** Fold one Claude stream-json event into trace fields. */
export function accumulateClaudeEvent(acc: ClaudeTraceAccumulator, event: ClaudeStreamEvent): void {
	if (event.type === "stream_event") {
		const delta = event.event?.delta;
		if (delta?.type === "text_delta" && typeof delta.text === "string") {
			pushAssistantText(acc, delta.text);
		}
		return;
	}

	if (event.type === "assistant" || event.message?.role === "assistant") {
		if (Array.isArray(event.message?.content)) {
			handleContentBlocks(acc, event.message.content);
		}
		return;
	}

	if (event.type === "user" || event.message?.role === "user") {
		if (Array.isArray(event.message?.content)) {
			handleContentBlocks(acc, event.message.content);
		}
		return;
	}

	if (event.type === "result") {
		acc.rawStatus = event.subtype ?? (event.is_error ? "error" : "success");
		acc.resultIsError = Boolean(event.is_error) || event.subtype === "error";
		if (typeof event.result === "string" && event.result.length > 0) {
			acc.resultText = event.result;
			// Final assistant prose when stream omitted message events.
			if (acc.agentMessages.length === 0) {
				pushAssistantText(acc, event.result);
			}
		}
		if (typeof event.error === "string" && event.error.length > 0) {
			acc.resultError = event.error;
		} else if (Array.isArray(event.errors) && event.errors.length > 0) {
			acc.resultError = event.errors.join("; ");
		}
		const usage = normalizeClaudeUsage(event.usage);
		if (usage) {
			acc.usage = mergeAgentUsage(acc.usage, usage);
		}
	}
}

export function finalizeClaudeTraceAccumulator(
	acc: ClaudeTraceAccumulator,
	options?: { gitDiff?: string; gitDiffTruncated?: boolean },
): AgentTrace {
	const trace = finalizeTraceAccumulator(acc, options);
	const artifacts = { ...trace.artifacts };
	if (acc.rawStatus) {
		artifacts.claudeRawStatus = acc.rawStatus;
	}
	if (acc.resultIsError) {
		artifacts.claudeResultIsError = "true";
	}
	if (acc.resultError) {
		artifacts.claudeResultError = acc.resultError;
	}
	return {
		...trace,
		artifacts,
	};
}

/** Normalize Claude NDJSON events into AgentTrace fields. */
export function buildTraceFromClaudeEvents(
	events: ClaudeStreamEvent[],
	options?: { gitDiff?: string },
): AgentTrace {
	const acc = createClaudeTraceAccumulator();
	for (const event of events) {
		accumulateClaudeEvent(acc, event);
	}
	return finalizeClaudeTraceAccumulator(acc, options);
}

export function parseClaudeNdjsonLine(line: string): ClaudeStreamEvent | undefined {
	const trimmed = line.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as ClaudeStreamEvent;
	} catch {
		return undefined;
	}
}
