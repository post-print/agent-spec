import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: ".",
	testMatch: "runner.spec.ts",
	fullyParallel: false,
});
