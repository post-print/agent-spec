import { openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { reviewer } from "./agent-suites/tour/agents.js";
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	timeout: 180_000,
	retries: 0,
	workers: 1,
	agent: openai(),
	judge: reviewer,
	workspace: "agent-suites/fixtures/task-list",
});
