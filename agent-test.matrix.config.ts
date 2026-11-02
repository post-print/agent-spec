import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { PINNED_MODELS } from "./agent-suites/models.js";
import { reviewer } from "./agent-suites/tour/agents.js";
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	// The escape battery calibrates hosts; it runs with the probe, not with ordinary suites.
	testIgnore: "**/escape/**",
	judge: reviewer,
	workspace: "agent-suites/fixtures/task-list",
	projects: [
		{ name: "openai", agent: openai({ model: PINNED_MODELS.openai }) },
		{ name: "claude", agent: claude({ model: PINNED_MODELS.claude }) },
		{ name: "cursor", agent: cursor() },
	],
});
