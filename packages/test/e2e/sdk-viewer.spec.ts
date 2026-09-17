import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loadSdkCatalog, sdkViewerRunner } from "../dist/sdk/viewer.js";
import { listenViewer } from "../src/viewer/server.js";

test("TypeScript catalog executes a comparison and retains the result after reload", async ({
	page,
}) => {
	const config = fileURLToPath(new URL("../fixtures/sdk-v2/agent-test.config.ts", import.meta.url));
	const { catalog, tests } = await loadSdkCatalog(config);
	const title = "variants, repetitions, tokens, and independently graded runs";
	catalog.suites[0].scenarios = catalog.suites[0].scenarios.filter(
		(scenario) => scenario.name === title,
	);
	const suite = catalog.suites[0].name;
	const viewer = await listenViewer({
		catalog,
		runner: sdkViewerRunner(config, tests),
		cwd: process.cwd(),
		suitesDir: config,
		workers: 1,
	});
	try {
		await page.goto(viewer.url);
		await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
		await page.locator("#run-selection").click();
		const verdict = page.locator(`[data-scenario-card="${suite}::${title}"] .focus-verdict`);
		await expect(verdict).toHaveText("passed", { timeout: 15000 });
		await expect(page.getByText("candidate · run 1", { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(verdict).toHaveText("passed");
		await page.screenshot({ path: "/private/tmp/agent-test-v2-viewer.png", fullPage: true });
	} finally {
		await viewer.close();
	}
});
