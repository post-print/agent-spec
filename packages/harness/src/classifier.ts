import { resolveClaudeAuthMode, runClaudeClassifier } from "./claude-run.js";
import {
	CURSOR_AUTH_MODE_ENV,
	type JudgeClassifierResult,
	resolveCursorAuthMode,
	runJudgeClassifier,
} from "./cursor-run.js";
import { getRegisteredAdapter } from "./host-registry.js";
import { OPENAI_AUTH_MODE_ENV, resolveOpenaiAuthMode, runOpenaiClassifier } from "./openai-run.js";
import { type AgentHost, isBuiltinAgentHost } from "./types.js";

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
	if (!isBuiltinAgentHost(host)) {
		const adapter = getRegisteredAdapter(host);
		if (adapter?.missingClassifierAuth) {
			return adapter.missingClassifierAuth();
		}
		if (adapter?.classify) {
			return undefined;
		}
		if (adapter?.classifierHost) {
			return missingClassifierAuth(adapter.classifierHost);
		}
		return `Host "${host}" has no classifier. Set classifierHost or implement classify().`;
	}
	switch (host) {
		case "claude":
			try {
				const mode = resolveClaudeAuthMode();
				if (mode === "api-key" && !process.env.ANTHROPIC_API_KEY?.trim()) {
					return "ANTHROPIC_API_KEY not set — required for --auth-mode api-key";
				}
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		case "openai":
			try {
				resolveOpenaiAuthMode(process.env[OPENAI_AUTH_MODE_ENV], apiKey);
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		default:
			try {
				resolveCursorAuthMode(process.env[CURSOR_AUTH_MODE_ENV], apiKey);
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
	}
}

/** One-shot text classifier on the same host family as the test agent. */
export async function runClassifier(options: ClassifierOptions): Promise<JudgeClassifierResult> {
	if (!isBuiltinAgentHost(options.host)) {
		const adapter = getRegisteredAdapter(options.host);
		if (adapter?.classify) {
			return adapter.classify({
				cwd: options.cwd,
				prompt: options.prompt,
				apiKey: options.apiKey,
			});
		}
		if (adapter?.classifierHost) {
			return runClassifier({ ...options, host: adapter.classifierHost });
		}
		throw new Error(
			`Host "${options.host}" has no classifier. Set classifierHost or implement classify().`,
		);
	}
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
