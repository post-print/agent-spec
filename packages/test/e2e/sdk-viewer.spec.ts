import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { loadSdkCatalog, sdkViewerRunner } from "../dist/sdk/viewer.js";
import { listenViewer } from "../src/viewer/server.js";

test("TypeScript resources execute parallel runs and retain evaluations after reload", async ({
	page,
}) => {
	const config = fileURLToPath(new URL("../fixtures/sdk-v2/agent-test.config.ts", import.meta.url));
	const { catalog, tests } = await loadSdkCatalog(config);
	const title = "parallel named runs and selected-input judging";
	catalog.suites[0].scenarios = catalog.suites[0].scenarios.filter((scenario) =>
		scenario.name.endsWith(title),
	);
	const suite = catalog.suites[0].name;
	const scenarioName = catalog.suites[0].scenarios[0].name;
	const viewer = await listenViewer({
		catalog,
		runner: sdkViewerRunner(config, tests),
		cwd: process.cwd(),
		suitesDir: config,
		workers: 1,
	});
	try {
		await page.goto(viewer.url);
		await expect(page.getByText(scenarioName, { exact: true }).first()).toBeVisible();
		await page.locator("#run-selection").click();
		const verdict = page.locator(`[data-scenario-card="${suite}::${scenarioName}"] .focus-verdict`);
		await expect(verdict).toHaveText("passed", { timeout: 15000 });
		await expect(page.getByText("candidate", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("accuracy", { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(verdict).toHaveText("passed");
		await page.screenshot({ path: "/private/tmp/agent-test-v2-viewer.png", fullPage: true });
	} finally {
		await viewer.close();
	}
});
