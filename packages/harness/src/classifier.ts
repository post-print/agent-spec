import { parseClaudeAuthMode, runClaudeClassifier } from "./claude-run.js";
import { type JudgeClassifierResult, runJudgeClassifier } from "./cursor-run.js";
import { runOpenaiClassifier } from "./openai-run.js";
import type { AgentHost } from "./types.js";

export interface ClassifierOptions {
	host: AgentHost;
	cwd: string;
	prompt: string;
	apiKey?: string;
}

/** Missing credential message for the host classifier. Undefined when auth is present. */
export function missingClassifierAuth(host: AgentHost, apiKey?: string): string | undefined {
	if (apiKey?.trim()) {
		return undefined;
	}
	switch (host) {
		case "claude":
			try {
				const mode = parseClaudeAuthMode(process.env.CLAUDE_AUTH_MODE);
				if (mode === "api-key" && !process.env.ANTHROPIC_API_KEY?.trim()) {
					return "ANTHROPIC_API_KEY not set — required for the Claude classifier";
				}
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		case "openai":
			if (!process.env.OPENAI_API_KEY?.trim() && !process.env.CODEX_API_KEY?.trim()) {
				return "OPENAI_API_KEY or CODEX_API_KEY not set — required for the OpenAI classifier";
			}
			return undefined;
		default:
			if (!process.env.CURSOR_API_KEY?.trim()) {
				return "CURSOR_API_KEY not set — required for the Cursor classifier";
			}
			return undefined;
	}
}

/** One-shot text classifier on the same host family as the test agent. */
export async function runClassifier(options: ClassifierOptions): Promise<JudgeClassifierResult> {
	switch (options.host) {
		case "claude":
			return runClaudeClassifier({
				cwd: options.cwd,
				prompt: options.prompt,
				apiKey: options.apiKey,
			});
		case "openai":
			return runOpenaiClassifier({
				cwd: options.cwd,
				prompt: options.prompt,
				apiKey: options.apiKey,
			});
		default:
			return runJudgeClassifier({
				cwd: options.cwd,
				prompt: options.prompt,
				apiKey: options.apiKey,
			});
	}
}
