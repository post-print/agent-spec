/**
 * Pinned so results can be compared across runs: the same test passed or failed on one Codex CLI
 * depending only on the model. Change one here to move every suite that reads it.
 */
export const PINNED_MODELS = {
	openai: "gpt-6-astra",
	claude: "claude-sonnet-5-5",
} as const;
