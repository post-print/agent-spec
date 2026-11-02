import { openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { PINNED_MODELS } from "./agent-suites/models.js";
import { reviewer } from "./agent-suites/tour/agents.js";
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	// The escape battery calibrates hosts; it runs with the probe, not with ordinary suites.
	testIgnore: "**/escape/**",
	timeout: 180_000,
	retries: 0,
	workers: 1,
	agent: openai({ model: PINNED_MODELS.openai }),
	judge: reviewer,
	workspace: "agent-suites/fixtures/task-list",
});
