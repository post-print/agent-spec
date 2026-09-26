import { openai } from "../../../harness/dist/index.js";
import { defineConfig } from "../../dist/index.js";

export default defineConfig({
	testDir: ".",
	testMatch: "timeout.spec.ts",
	timeout: 2_000,
	workers: 1,
	agent: openai({ timeoutMs: 75 }),
	workspace: "./project",
});
