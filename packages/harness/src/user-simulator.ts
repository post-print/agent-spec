import { missingClassifierAuth, runClassifier } from "./classifier.js";
import type { UserQuestion, UserSimulator } from "./conversation.js";
import { formatTraceForJudge } from "./judge.js";
import type { AgentHost } from "./types.js";

export interface JudgeUserSimulatorOptions {
	cwd: string;
	apiKey?: string;
	host?: AgentHost;
}

function formatQuestions(questions: UserQuestion[]): string {
	return questions
		.map((question, index) => {
			const options = question.options?.length ? ` Options: ${question.options.join("; ")}` : "";
			return `${index + 1}. ${question.prompt}${options}`;
		})
		.join("\n");
}

function buildUserPrompt(questions: UserQuestion[], transcript: string): string {
	return [
		"You are the human user in a coding-agent test.",
		"Answer the agent question so the task can continue.",
		"Keep the answer short and concrete. Do not use tools.",
		"",
		"Questions:",
		formatQuestions(questions),
		"",
		"Transcript:",
		transcript,
	].join("\n");
}

/** Default user agent: a one-shot classifier that answers AskQuestion prompts. */
export function createJudgeUserSimulator(options: JudgeUserSimulatorOptions): UserSimulator {
	return {
		async reply({ questions, trace }) {
			const host = options.host ?? "cursor";
			const missing = missingClassifierAuth(host, options.apiKey);
			if (missing) {
				throw new Error(`${missing} — required for the default user simulator`);
			}
			const result = await runClassifier({
				host,
				cwd: options.cwd,
				prompt: buildUserPrompt(questions, formatTraceForJudge(trace)),
				apiKey: options.apiKey,
			});
			const text = result.text.trim();
			if (result.status !== "completed" || !text) {
				throw new Error(result.sdkError?.message ?? "user simulator failed");
			}
			return text;
		},
	};
}
