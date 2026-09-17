import { claude, cursor, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";

export default defineConfig({
	testDir: "./agent-suites",
	testMatch: "**/*.spec.ts",
	timeout: 180_000,
	retries: 0,
	workers: 1,
	use: { workspace: "agent-suites/fixtures/task-list" },
	projects: [
		{ name: "openai", use: { agent: openai() } },
		{ name: "claude", use: { agent: claude() } },
		{ name: "cursor", use: { agent: cursor() } },
	],
});
