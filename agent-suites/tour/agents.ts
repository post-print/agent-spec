import { fileURLToPath } from "node:url";
import { openai } from "@post-print/agent-harness";
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
