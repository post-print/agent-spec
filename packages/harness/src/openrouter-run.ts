import type { AgentEvent } from "./agent-definition.js";
import type { AgentTrace, AgentUsage } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TRAILING_SLASH = /\/$/;

export interface OpenRouterRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: string;
	baseUrl?: string;
	httpReferer?: string;
	xTitle?: string;
	timeoutMs?: number;
	onAgentEvent?: (event: AgentEvent) => void;
}

export interface OpenRouterRunResult {
	status: "completed" | "failed";
	trace: AgentTrace;
}

let activeRun: AbortController | undefined;

export function cancelActiveOpenRouterRun(): void {
	activeRun?.abort();
	activeRun = undefined;
}

function streamDelta(event: Record<string, unknown>): string | undefined {
	const choices = event.choices;
	const choice = Array.isArray(choices) ? choices[0] : undefined;
	if (!choice || typeof choice !== "object") return undefined;
	const delta = (choice as Record<string, unknown>).delta;
	if (!delta || typeof delta !== "object") return undefined;
	const content = (delta as Record<string, unknown>).content;
	return typeof content === "string" ? content : undefined;
}

function streamLine(
	line: string,
	onText: (text: string) => void,
	onUsage: (usage: AgentUsage) => void,
): string {
	if (!line.startsWith("data:")) return "";
	const data = line.slice(5).trim();
	if (data === "[DONE]") return "";
	const event = JSON.parse(data) as Record<string, unknown>;
	const text = streamDelta(event) ?? "";
	if (text) onText(text);
	const usage = usageFrom(event.usage);
	if (usage) onUsage(usage);
	return text;
}

async function readStream(
	response: Response,
	onText: (text: string) => void,
	onUsage: (usage: AgentUsage) => void,
): Promise<string> {
	if (!response.body) throw new Error("OpenRouter response did not include a body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let answer = "";
	for (;;) {
		const chunk = await reader.read();
		buffer += decoder.decode(chunk.value, { stream: !chunk.done });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) answer += streamLine(line, onText, onUsage);
		if (chunk.done) return answer;
	}
}

async function requestOpenRouter(
	options: OpenRouterRunOptions,
	controller: AbortController,
): Promise<string> {
	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(TRAILING_SLASH, "");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${options.apiKey}`,
		"Content-Type": "application/json",
	};
	if (options.httpReferer) headers["HTTP-Referer"] = options.httpReferer;
	if (options.xTitle) headers["X-Title"] = options.xTitle;
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: options.model,
			messages: [{ role: "user", content: options.prompt }],
			stream: true,
			stream_options: { include_usage: true },
		}),
		signal: controller.signal,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => undefined);
		throw new Error(`${response.status}: ${readErrorBody(body)}`);
	}
	return readStream(
		response,
		(text) => options.onAgentEvent?.({ type: "text", text }),
		(usage) => options.onAgentEvent?.({ type: "usage", usage }),
	);
}

function emptyTrace(prompt: string): AgentTrace {
	return {
		messages: [{ role: "user", content: prompt }],
		toolCalls: [],
		shellCommands: [],
		artifacts: {},
	};
}

function usageFrom(raw: unknown): AgentUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const value = raw as Record<string, unknown>;
	const prompt = value.prompt_tokens;
	const completion = value.completion_tokens;
	const total = value.total_tokens;
	const usage: AgentUsage = {};
	if (typeof prompt === "number") usage.inputTokens = prompt;
	if (typeof completion === "number") usage.outputTokens = completion;
	if (typeof total === "number") usage.totalTokens = total;
	return Object.keys(usage).length ? usage : undefined;
}

function readErrorBody(raw: unknown): string {
	if (raw && typeof raw === "object") {
		const error = (raw as Record<string, unknown>).error;
		if (
			error &&
			typeof error === "object" &&
			typeof (error as Record<string, unknown>).message === "string"
		)
			return (error as Record<string, string>).message;
		if (typeof error === "string") return error;
	}
	return "OpenRouter request failed";
}

function validationError(options: OpenRouterRunOptions): string | undefined {
	if (!options.apiKey) return "OPENROUTER_API_KEY is required";
	if (!options.model?.trim()) return "openrouter() requires a model";
	return undefined;
}

export async function runOpenRouterAgent(
	options: OpenRouterRunOptions,
): Promise<OpenRouterRunResult> {
	const trace = emptyTrace(options.prompt);
	const invalid = validationError(options);
	if (invalid) {
		trace.artifacts.openrouterError = invalid;
		return { status: "failed", trace };
	}
	const controller = new AbortController();
	activeRun = controller;
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	let usage: AgentUsage | undefined;
	try {
		const answer = await requestOpenRouter(
			{
				...options,
				onAgentEvent: (event) => {
					if (event.type === "usage") usage = event.usage;
					options.onAgentEvent?.(event);
				},
			},
			controller,
		);
		if (answer) trace.messages.push({ role: "assistant", content: answer });
		if (usage) trace.usage = usage;
		return { status: "completed", trace };
	} catch (error) {
		trace.artifacts.openrouterError = error instanceof Error ? error.message : String(error);
		return { status: "failed", trace };
	} finally {
		clearTimeout(timeout);
		if (activeRun === controller) activeRun = undefined;
	}
}
