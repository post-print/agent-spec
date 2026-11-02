import { claude } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

// Behavior controls: the real suites against a scripted host. No provider is contacted. The host is
// run pinned, bare under a test key, and calibrated by the gate, so a good behavior can pass.
const SCRIPTED = {
	model: "scripted",
	auth: { type: "api-key" as const, env: "AGENT_TEST_FIXTURE_KEY" },
	loadProjectContext: false,
};
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: ["test-sdk-capabilities/**/*.spec.ts", "escape/**/*.spec.ts"],
	outputDir: "./test-results/controls",
	timeout: 60_000,
	workers: 1,
	agent: claude(SCRIPTED),
	judge: claude(SCRIPTED),
	workspace: "agent-suites/fixtures/task-list",
});
