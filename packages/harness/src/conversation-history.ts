/**
 * Built-in hosts do not resume native sessions. A continuation replays earlier user and
 * assistant text (not tool calls or results) ahead of the new request.
 */
export function reconstructedPrompt(history: readonly string[], prompt: string): string {
	if (!history.length) return prompt;
	return `Previous conversation (context only):\n${history.join("\n\n")}\n\nCurrent user request:\n${prompt}`;
}

/** The history entries one completed turn contributes. */
export function historyTurn(prompt: string, answer: string): [string, string] {
	return [`User: ${prompt}`, `Assistant: ${answer}`];
}
