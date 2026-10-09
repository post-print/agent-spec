import { cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openai } from "@post-print/agent-harness";
import { runCommand } from "@post-print/agent-test";

/** The repository root; fixture paths below are relative to it. */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const reviewer = openai({
	context: {
		instructions: ["Support conclusions with concrete evidence."],
		files: ["agent-suites/tour/review-standards.md"],
	},
});
// The skill lives outside every fixture, so its presence in a workspace proves attachment.
export const releaseSkills = ["agent-suites/skills/release-note"];
export const RELEASE_SKILL_FIXTURE = "agent-suites/fixtures/task-list-skill";
// Task records exist only behind the MCP server; no file in this workspace has a due date.
export const TASK_SERVICE_FIXTURE = "agent-suites/fixtures/task-service";
const HIDDEN_STATUS_TESTS = fileURLToPath(
	new URL("../fixtures/task-list-hidden/tests", import.meta.url),
);

export const taskRecordsMcp = {
	type: "stdio" as const,
	tools: ["echo", "lookup", "search_tasks", "get_task", "task_index"],
	command: "node",
	args: [
		fileURLToPath(new URL("../../packages/test/fixtures/mcp-echo/server.mjs", import.meta.url)),
	],
};

/** Run the visible status tests in a run's final workspace copy, independent of the agent. */
export function runStatusTests(finalPath: string) {
	return runCommand(finalPath, ["bun", "test", "tests/status.test.ts"]);
}

/** Copy held-out status tests into a final workspace copy and run them there. */
export async function runHiddenStatusTests(finalPath: string) {
	await cp(HIDDEN_STATUS_TESTS, join(finalPath, "tests"), { recursive: true });
	return runCommand(finalPath, ["bun", "test", "tests/status.hidden.test.ts"]);
}
