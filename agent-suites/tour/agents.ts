import { fileURLToPath } from "node:url";
import { openai } from "@post-print/agent-harness";
import { z } from "@post-print/agent-test";
export const reviewer = openai({
	context: {
		instructions: ["Support conclusions with concrete evidence."],
		files: ["agent-suites/tour/review-standards.md"],
	},
});
export const releaseSkills = ["agent-suites/fixtures/task-list-skill/.agents/skills/release-note"];
export const taskService = {
	type: "stdio" as const,
	tools: ["echo", "lookup", "search_tasks", "get_task", "task_index"],
	command: "node",
	args: [
		fileURLToPath(new URL("../../packages/test/fixtures/mcp-echo/server.mjs", import.meta.url)),
	],
};
export const repairEvaluation = {
	prompt:
		"Check the supplied repair. Correctness: 0 incorrect, 1 partial, 2 correct for open and completed tasks. Scope: 0 unrelated edits, 1 necessary edits only. Explain your assessment.",
	schema: z.object({
		correctness: z.union([z.literal(0), z.literal(1), z.literal(2)]),
		scope: z.union([z.literal(0), z.literal(1)]),
		reason: z.string().min(1),
	}),
};
export const answerEvaluation = {
	prompt:
		"Compare each answer against the supplied reference. Mark each correct only when it gives the reference date.",
	schema: z.object({
		baselineCorrect: z.boolean(),
		candidateCorrect: z.boolean(),
		reason: z.string().min(1),
	}),
};
