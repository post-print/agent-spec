import { claude, openai } from "@post-print/agent-harness";
import { defineConfig } from "@post-print/agent-test";
import { PINNED_MODELS } from "./agent-suites/models.js";

// The nightly live proof: API-key hosts that can run --verdict-grade, so a pass here can stand.
// The probe and escape battery calibrate each host first; the live subject controls follow.
const openaiKey = { type: "api-key" as const, env: "OPENAI_API_KEY" };
const claudeKey = { type: "api-key" as const, env: "ANTHROPIC_API_KEY" };
export default defineConfig({
	testDir: "./agent-suites",
	testMatch: ["host-probe/**/*.spec.ts", "escape/**/*.spec.ts", "reference/**/*.spec.ts"],
	timeout: 600_000,
	workspace: "agent-suites/fixtures/task-list",
	judge: openai({ model: PINNED_MODELS.openai, auth: openaiKey }),
	projects: [
		{ name: "openai", agent: openai({ model: PINNED_MODELS.openai, auth: openaiKey }) },
		{
			name: "claude",
			agent: claude({ model: PINNED_MODELS.claude, auth: claudeKey, loadProjectContext: false }),
		},
	],
});
