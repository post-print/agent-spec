import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { PINNED_MODELS } from "./agent-suites/models.js";
// One project per host: a passing project calibrates that host version for every other run.
export default defineConfig({
	testDir: "./agent-suites/host-probe",
	testMatch: "**/*.spec.ts",
	timeout: 600_000,
	workspace: "agent-suites/fixtures/task-list",
	projects: [
		{ name: "openai", agent: openai({ model: PINNED_MODELS.openai }) },
		{ name: "claude", agent: claude({ model: PINNED_MODELS.claude }) },
		{ name: "cursor", agent: cursor() },
	],
});
