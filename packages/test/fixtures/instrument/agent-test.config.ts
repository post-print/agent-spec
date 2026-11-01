import { claude } from "../../../harness/dist/index.js";
import { defineConfig } from "../../dist/index.js";

export default defineConfig({
	testDir: ".",
	testMatch: "instrument.spec.ts",
	outputDir: "./test-results/instrument",
	timeout: 30_000,
	workers: 1,
	agent: claude({ timeoutMs: 20_000 }),
	workspace: "./project",
});
