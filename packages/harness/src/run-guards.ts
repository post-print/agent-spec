import type { AgentTrace } from "./types.js";

/** Tools that block until the user replies — incompatible with single-shot headless runs. */
const USER_INPUT_TOOL_PATTERN = /^(askquestion|ask_question|user_question|request_user_input)$/i;

export function isUserInputTool(toolName: string): boolean {
	return USER_INPUT_TOOL_PATTERN.test(toolName.trim());
}

export function traceHasUserInputTool(toolCalls: Array<{ name: string }>): boolean {
	return toolCalls.some((call) => isUserInputTool(call.name));
}

/** Errors that may carry a partial streamed trace for debug bundles. */
export interface PartialTraceCarrier {
	trace?: AgentTrace;
}

export function getPartialTrace(error: unknown): AgentTrace | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const trace = (error as PartialTraceCarrier).trace;
	return trace && typeof trace === "object" ? trace : undefined;
}

export class AgentRunTimeoutError extends Error implements PartialTraceCarrier {
	readonly timeoutMs: number;
	trace?: AgentTrace;

	constructor(timeoutMs: number) {
		super(`agent timed out after ${timeoutMs}ms waiting for run completion`);
		this.name = "AgentRunTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export class UserInputRequiredError extends Error implements PartialTraceCarrier {
	readonly toolName: string;
	trace?: AgentTrace;

	constructor(toolName: string) {
		super(
			`agent invoked ${toolName} in headless mode (no follow-up turn; use replay, skip live, or reshape the scenario for one-shot completion)`,
		);
		this.name = "UserInputRequiredError";
		this.toolName = toolName;
	}
}

export interface RunTimeoutOptions {
	/** Best-effort cleanup when the deadline fires (e.g. cancel an SDK run). */
	onTimeout?: () => void | Promise<void>;
}

/** Race `operation` against a hard deadline. */
export async function withRunTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
	options?: RunTimeoutOptions,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return operation();
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const operationPromise = operation();
	operationPromise.catch(() => {
		// Swallow late rejections when the timeout branch wins the race.
	});

	try {
		return await Promise.race([
			operationPromise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					void options?.onTimeout?.();
					reject(new AgentRunTimeoutError(timeoutMs));
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	}
}
