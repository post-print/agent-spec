import {
	accumulateSdkEvent,
	createTraceAccumulator,
	finalizeTraceAccumulator,
	type SdkMessage,
} from "./capture.js";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";
import type { AgentTrace } from "./types.js";

/** Default local agent model; override with CURSOR_AGENT_MODEL or options.model. */
const DEFAULT_CURSOR_MODEL = "auto";

function judgeModelSelection(override?: JudgeClassifierOptions["model"]): {
	id: string;
	params?: Array<{ id: string; value: string }>;
} {
	const id =
		override?.id ??
		process.env.CURSOR_JUDGE_MODEL ??
		process.env.CURSOR_AGENT_MODEL ??
		DEFAULT_CURSOR_MODEL;
	const params = override?.params ?? judgeModelParamsFromEnv();
	return params ? { id, params } : { id };
}

function judgeModelParamsFromEnv():
	| Array<{ id: string; value: string }>
	| undefined {
	const raw = process.env.CURSOR_JUDGE_TEMPERATURE ?? "0";
	if (!raw.trim()) {
		return undefined;
	}
	return [{ id: "temperature", value: raw.trim() }];
}

export interface CursorRunOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: { id: string; params?: Array<{ id: string; value: string }> };
	mcpServers?: Record<string, McpServerConfig>;
}

export interface JudgeClassifierOptions {
	cwd: string;
	prompt: string;
	apiKey?: string;
	model?: { id: string; params?: Array<{ id: string; value: string }> };
}

export interface JudgeClassifierResult {
	status: string;
	text: string;
}

export interface CursorRunResult {
	status: string;
	trace: AgentTrace;
}

/** Map Cursor SDK terminal status to harness run status. */
export function normalizeSdkRunStatus(status: string): "completed" | "failed" {
	return status === "finished" || status === "completed"
		? "completed"
		: "failed";
}

/** Shared Cursor SDK path — Agent.create + send + wait (runs and judge use the same surface). */
export async function runCursorAgent(
	options: CursorRunOptions,
): Promise<CursorRunResult> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		throw new Error("CURSOR_API_KEY not set");
	}

	const sdkModule = await import("@cursor/sdk");
	const modelId =
		options.model?.id ?? process.env.CURSOR_AGENT_MODEL ?? DEFAULT_CURSOR_MODEL;
	const mcpServers = resolveMcpServers(options.mcpServers, {
		cwd: options.cwd,
	});
	await using agent = await sdkModule.Agent.create({
		apiKey,
		model: { id: modelId },
		local: { cwd: options.cwd },
		...(mcpServers ? { mcpServers } : {}),
	});

	const run = await agent.send(options.prompt);
	const acc = createTraceAccumulator();
	for await (const event of run.stream()) {
		accumulateSdkEvent(acc, event);
	}
	const result = await run.wait();
	return {
		status: normalizeSdkRunStatus(result.status),
		trace: finalizeTraceAccumulator(acc),
	};
}

/** Classifier-only judge path — one-shot Agent.prompt, JSON reply, temperature 0 when supported. */
export async function runJudgeClassifier(
	options: JudgeClassifierOptions,
): Promise<JudgeClassifierResult> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		throw new Error("CURSOR_API_KEY not set");
	}

	const sdkModule = await import("@cursor/sdk");
	const result = await sdkModule.Agent.prompt(options.prompt, {
		apiKey,
		model: judgeModelSelection(options.model),
		name: "agent-spec-judge",
		local: { cwd: options.cwd },
	});

	const text = result.result?.trim() ?? "";
	const status = result.status === "finished" ? "completed" : result.status;
	return {
		status: normalizeSdkRunStatus(status),
		text,
	};
}

/** Assistant prose from a Cursor SDK message stream (last assistant block wins for short replies). */
export function assistantTextFromSdkMessages(messages: SdkMessage[]): string {
	const chunks: string[] = [];
	for (const event of messages) {
		const text = textBlocksFromSdkMessage(event);
		if (
			text.length > 0 &&
			(event.type === "assistant" || event.message?.role === "assistant")
		) {
			chunks.push(text);
		}
	}
	return chunks.join("\n").trim();
}

export function textBlocksFromSdkMessage(event: SdkMessage): string {
	const parts: string[] = [];

	if (event.message?.content) {
		for (const block of event.message.content) {
			if (block.text) {
				parts.push(block.text);
			}
		}
	}

	if (event.tool?.input !== undefined) {
		parts.push(
			typeof event.tool.input === "string"
				? event.tool.input
				: JSON.stringify(event.tool.input),
		);
	}
	if (event.tool?.output) {
		parts.push(event.tool.output);
	}

	return parts.join("\n");
}
