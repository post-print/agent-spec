import { claude } from "../../../harness/dist/index.js";
import { defineConfig } from "../../dist/index.js";

// The instrument's scripted host with no model pinned, in a suite that accepts exactly that, so a
// pass here ends as accepted rather than indicative or passed.
const UNPINNED = {
	timeoutMs: 20_000,
	auth: { type: "api-key" as const, env: "AGENT_TEST_FIXTURE_KEY" },
	loadProjectContext: false,
};

export default defineConfig({
	testDir: ".",
	testMatch: "instrument.spec.ts",
	outputDir: "./test-results/instrument-accepted",
	timeout: 30_000,
	workers: 1,
	agent: claude(UNPINNED),
	judge: claude(UNPINNED),
	workspace: "./project",
	accept: { conditions: ["model"], reason: "The scripted host has no model to pin." },
});
