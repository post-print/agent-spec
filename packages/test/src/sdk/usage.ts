import type { RunUsage } from "./types.js";
export function runUsage(usage?: {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
}): RunUsage {
	return {
		tokens: {
			input: usage?.inputTokens,
			output: usage?.outputTokens,
			total: usage?.totalTokens,
			cacheRead: usage?.cacheReadTokens,
			cacheWrite: usage?.cacheWriteTokens,
			reasoning: usage?.reasoningTokens,
		},
	};
}
