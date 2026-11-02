import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { PINNED_MODELS } from "./agent-suites/models.js";
// One project per host: a passing probe calibrates that host version and auth mode, and the escape
// battery records which ways out of the seal it holds. Both count for a week.
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: ["host-probe/**/*.spec.ts", "escape/**/*.spec.ts"],
	timeout: 600_000,
	workspace: "agent-suites/fixtures/task-list",
	projects: [
		{ name: "openai", agent: openai({ model: PINNED_MODELS.openai }) },
		{ name: "claude", agent: claude({ model: PINNED_MODELS.claude }) },
		{ name: "cursor", agent: cursor() },
	],
});
