/** Tools that block until the user replies — incompatible with single-shot headless runs. */
const USER_INPUT_TOOL_PATTERN =
	/^(askquestion|ask_question|user_question|request_user_input)$/i;

export function isUserInputTool(toolName: string): boolean {
	return USER_INPUT_TOOL_PATTERN.test(toolName.trim());
}

export function traceHasUserInputTool(
	toolCalls: Array<{ name: string }>,
): boolean {
	return toolCalls.some((call) => isUserInputTool(call.name));
}

export class AgentRunTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(
			`agent timed out after ${timeoutMs}ms waiting for run completion`,
		);
		this.name = "AgentRunTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export class UserInputRequiredError extends Error {
	readonly toolName: string;

	constructor(toolName: string) {
		super(
			`agent invoked ${toolName} in headless mode (no follow-up turn; use replay, skip live, or reshape the scenario for one-shot completion)`,
		);
		this.name = "UserInputRequiredError";
		this.toolName = toolName;
	}
}

/** Race `operation` against a hard deadline. */
export async function withRunTimeout<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return operation();
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation(),
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
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
