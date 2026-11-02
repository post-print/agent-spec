import type { AgentEvent } from "./agent-definition.js";
import { type AgentInfrastructureCode, AgentInfrastructureError } from "./agent-error.js";
import { codeForProviderStatus, redactSecrets } from "./host-failure.js";
import { AgentRunTimeoutError } from "./run-guards.js";
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
	failureCode?: AgentInfrastructureCode;
}

/** Everything the response has shown so far, kept when the stream fails partway. */
interface OpenRouterStream {
	answer: string;
	usage?: AgentUsage;
	finishReason?: string;
	sawDone: boolean;
	droppedLines: number;
	providerError?: AgentInfrastructureError;
}

let activeRun: AbortController | undefined;

export function cancelActiveOpenRouterRun(): void {
	activeRun?.abort();
	activeRun = undefined;
}

function firstChoice(event: Record<string, unknown>): Record<string, unknown> | undefined {
	const choices = event.choices;
	const choice = Array.isArray(choices) ? choices[0] : undefined;
	return choice && typeof choice === "object" ? (choice as Record<string, unknown>) : undefined;
}

function streamDelta(choice: Record<string, unknown> | undefined): string | undefined {
	const delta = choice?.delta;
	if (!delta || typeof delta !== "object") return undefined;
	const content = (delta as Record<string, unknown>).content;
	return typeof content === "string" ? content : undefined;
}

/** OpenRouter reports a failure after the 200 as an `error` field on a stream chunk. */
function midstreamError(raw: unknown): AgentInfrastructureError {
	const status = (raw as { code?: unknown } | null | undefined)?.code;
	const code = typeof status === "number" ? codeForProviderStatus(status) : undefined;
	return new AgentInfrastructureError(
		`OpenRouter failed mid-stream: ${readErrorBody({ error: raw })}`,
		code ?? "provider_unavailable",
	);
}

function parseStreamEvent(data: string): Record<string, unknown> | undefined {
	try {
		const event = JSON.parse(data);
		return event && typeof event === "object" ? event : undefined;
	} catch {
		return undefined;
	}
}

function applyStreamEvent(
	stream: OpenRouterStream,
	event: Record<string, unknown>,
	options: OpenRouterRunOptions,
): void {
	if (event.error) stream.providerError ??= midstreamError(event.error);
	const choice = firstChoice(event);
	if (typeof choice?.finish_reason === "string") stream.finishReason = choice.finish_reason;
	const text = streamDelta(choice);
	if (text) {
		stream.answer += text;
		options.onAgentEvent?.({ type: "text", text });
	}
	const usage = usageFrom(event.usage);
	if (usage) {
		stream.usage = usage;
		options.onAgentEvent?.({ type: "usage", usage });
	}
}

function applyStreamLine(
	stream: OpenRouterStream,
	line: string,
	options: OpenRouterRunOptions,
): void {
	if (!line.startsWith("data:")) return;
	const data = line.slice(5).trim();
	if (data === "[DONE]") {
		stream.sawDone = true;
		return;
	}
	const event = parseStreamEvent(data);
	if (event) applyStreamEvent(stream, event, options);
	else stream.droppedLines += 1;
}

async function readStream(
	response: Response,
	stream: OpenRouterStream,
	options: OpenRouterRunOptions,
): Promise<void> {
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const chunk = await reader.read();
		buffer += decoder.decode(chunk.value, { stream: !chunk.done });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) applyStreamLine(stream, line, options);
		if (chunk.done) {
			applyStreamLine(stream, buffer, options);
			return;
		}
	}
}

async function rejectedResponseError(response: Response): Promise<AgentInfrastructureError> {
	const body = await response.json().catch(() => undefined);
	return new AgentInfrastructureError(
		`OpenRouter returned ${response.status}: ${readErrorBody(body)}`,
		codeForProviderStatus(response.status) ?? "host_exit",
	);
}

function openRouterHeaders(options: OpenRouterRunOptions): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${options.apiKey}`,
		"Content-Type": "application/json",
	};
	if (options.httpReferer) headers["HTTP-Referer"] = options.httpReferer;
	if (options.xTitle) headers["X-Title"] = options.xTitle;
	return headers;
}

async function postCompletion(
	options: OpenRouterRunOptions,
	signal: AbortSignal,
): Promise<Response> {
	const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(TRAILING_SLASH, "");
	return await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: openRouterHeaders(options),
		body: JSON.stringify({
			model: options.model,
			messages: [{ role: "user", content: options.prompt }],
			stream: true,
			stream_options: { include_usage: true },
		}),
		signal,
	}).catch((error: unknown) => {
		if (signal.aborted) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		throw new AgentInfrastructureError(
			`OpenRouter could not be reached: ${detail}`,
			"provider_unavailable",
		);
	});
}

async function requestOpenRouter(
	options: OpenRouterRunOptions,
	stream: OpenRouterStream,
	signal: AbortSignal,
): Promise<void> {
	const response = await postCompletion(options, signal);
	if (!response.ok) throw await rejectedResponseError(response);
	await readStream(response, stream, options).catch((error: unknown) => {
		if (signal.aborted) throw error;
		const detail = error instanceof Error ? error.message : String(error);
		throw new AgentInfrastructureError(
			`OpenRouter stream broke before it finished: ${detail}`,
			"capture_incomplete",
		);
	});
}

/** The API's own end marker, and a reply or finish reason before it, make a run complete. */
function incompleteStreamFailure(stream: OpenRouterStream): AgentInfrastructureError | undefined {
	if (stream.providerError) return stream.providerError;
	if (stream.finishReason === "error")
		return new AgentInfrastructureError(
			"OpenRouter stream finished with finish_reason error",
			"provider_unavailable",
		);
	if (!stream.sawDone)
		return new AgentInfrastructureError(
			"OpenRouter response ended without [DONE]",
			"capture_incomplete",
		);
	if (stream.answer || stream.finishReason) return undefined;
	return new AgentInfrastructureError(
		"OpenRouter response finished with no reply",
		"capture_incomplete",
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

function validationFailure(options: OpenRouterRunOptions): OpenRouterRunResult | undefined {
	const trace = emptyTrace(options.prompt);
	if (!options.apiKey) {
		trace.artifacts.openrouterError = "OPENROUTER_API_KEY is required";
		return { status: "failed", trace, failureCode: "auth" };
	}
	if (options.model?.trim()) return undefined;
	trace.artifacts.openrouterError = "openrouter() requires a model";
	return { status: "failed", trace };
}

/** Whatever streamed before a failure stays in the trace as evidence. */
function streamedTrace(options: OpenRouterRunOptions, stream: OpenRouterStream): AgentTrace {
	const trace = emptyTrace(options.prompt);
	if (stream.answer) trace.messages.push({ role: "assistant", content: stream.answer });
	if (stream.usage) trace.usage = stream.usage;
	if (stream.finishReason) trace.artifacts.openrouterFinishReason = stream.finishReason;
	if (stream.droppedLines > 0) trace.artifacts.droppedOutputLines = String(stream.droppedLines);
	return trace;
}

function failedRun(trace: AgentTrace, failure: AgentInfrastructureError): OpenRouterRunResult {
	trace.artifacts.openrouterError = redactSecrets(failure.message);
	return { status: "failed", trace, failureCode: failure.code };
}

function abortedRunFailure(): AgentInfrastructureError {
	return new AgentInfrastructureError("OpenRouter request was cancelled", "host_exit");
}

export async function runOpenRouterAgent(
	options: OpenRouterRunOptions,
): Promise<OpenRouterRunResult> {
	const invalid = validationFailure(options);
	if (invalid) return invalid;
	const stream: OpenRouterStream = { answer: "", sawDone: false, droppedLines: 0 };
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	activeRun = controller;
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	try {
		await requestOpenRouter(options, stream, controller.signal);
		const trace = streamedTrace(options, stream);
		const failure = incompleteStreamFailure(stream);
		return failure ? failedRun(trace, failure) : { status: "completed", trace };
	} catch (error) {
		const trace = streamedTrace(options, stream);
		if (timedOut) throw Object.assign(new AgentRunTimeoutError(timeoutMs), { trace });
		return failedRun(
			trace,
			error instanceof AgentInfrastructureError ? error : abortedRunFailure(),
		);
	} finally {
		clearTimeout(timeout);
		if (activeRun === controller) activeRun = undefined;
	}
}
