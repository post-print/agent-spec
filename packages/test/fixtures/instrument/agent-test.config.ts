import { claude } from "../../../harness/dist/index.js";
import { defineConfig } from "../../dist/index.js";

// A scripted host run as a verdict-grade one: pinned, bare under a test key, and calibrated by the
// contract before it runs, so a pass here can stand as a pass.
const SCRIPTED = {
	timeoutMs: 20_000,
	model: "fake",
	auth: { type: "api-key" as const, env: "AGENT_TEST_FIXTURE_KEY" },
	loadProjectContext: false,
};

export default defineConfig({
	testDir: ".",
	testMatch: "instrument.spec.ts",
	outputDir: "./test-results/instrument",
	timeout: 30_000,
	workers: 1,
	agent: claude(SCRIPTED),
	judge: claude(SCRIPTED),
	workspace: "./project",
});
