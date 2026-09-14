import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: ci,
	retries: ci ? 1 : 0,
	workers: ci ? 2 : undefined,
	reporter: ci ? [["github"], ["list"]] : "list",
	timeout: 20_000,
	expect: { timeout: 8_000 },
	outputDir: "./test-results",
	use: {
		...devices["Desktop Chrome"],
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
