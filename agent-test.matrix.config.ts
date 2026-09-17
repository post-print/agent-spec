import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { reviewer } from "./agent-suites/tour/agents.js";
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	judge: reviewer,
	workspace: "agent-suites/fixtures/task-list",
	projects: [
		{ name: "openai", agent: openai() },
		{ name: "claude", agent: claude() },
		{ name: "cursor", agent: cursor() },
	],
});
