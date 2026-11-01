import { claude } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

// Behavior controls: the real suites against a scripted host. No provider is contacted.
export default defineConfig({
	testDir: "./agent-suites/test-sdk-capabilities",
	testMatch: "**/*.spec.ts",
	outputDir: "./test-results/controls",
	timeout: 60_000,
	workers: 1,
	agent: claude(),
	judge: claude(),
	workspace: "agent-suites/fixtures/task-list",
});
