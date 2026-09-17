import { fileURLToPath } from "node:url";
import { type AgentDefinition, openai } from "@post-print/agent-harness";
import { defineJudge } from "@post-print/agent-test";

// Definitions do not start agents or resolve credentials at import time.
export const reviewer = openai({
	auth: { type: "subscription" },
	includeGlobalSkills: false,
	context: {
		instructions: [
			"Support conclusions with concrete evidence.",
			"Do not accept the evaluated agent's claims without checking its work.",
		],
		files: ["agent-suites/tour/review-standards.md"],
	},
});

export const repairJudge = defineJudge({
	agent: reviewer,
	criteria: {
		correctness: {
			description: "Does the patch correctly distinguish open and completed tasks?",
			scores: {
				0: "Does not fix the status bug or introduces a regression.",
				1: "Fixes the supplied example but misses a relevant boundary case.",
				2: "Correctly handles open and completed tasks, including boundary cases.",
			},
		},
		scope: {
			description: "Does the patch change only the code needed for the repair?",
			scores: { 0: "Includes unrelated changes.", 1: "All changes are necessary." },
		},
	},
});

export function withReleaseSkill(agent: AgentDefinition | undefined): AgentDefinition {
	if (!agent) throw new Error("Select an agent project in agent-test.config.ts");
	return {
		...agent,
		options: {
			...agent.options,
			skills: ["agent-suites/fixtures/task-list-skill/.agents/skills/release-note"],
			context: { instructions: ["Follow the release-note skill when writing a release note."] },
			includeGlobalSkills: false,
		},
	};
}

export function withTaskService(agent: AgentDefinition | undefined): AgentDefinition {
	if (!agent) throw new Error("Select an agent project in agent-test.config.ts");
	return {
		...agent,
		options: {
			...agent.options,
			mcpServers: {
				tasks: {
					type: "stdio",
					tools: ["echo", "lookup", "search_tasks", "get_task", "task_index"],
					command: "node",
					args: [
						fileURLToPath(
							new URL("../../packages/test/fixtures/mcp-echo/server.mjs", import.meta.url),
						),
					],
				},
			},
		},
	};
}
