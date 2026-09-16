import { expect, test } from "@playwright/test";

import { hostTab, liveSlot, openViewer, runCell, type ViewerHarness } from "./helpers/viewer.js";

async function startHello(page: Parameters<typeof openViewer>[0]) {
	await hostTab(page, "smoke", "hello", "cursor").click();
	await runCell(page, "smoke", "hello", "cursor").click();
}

test.describe("viewer live updates", () => {
	let viewer: ViewerHarness | undefined;

	test.afterEach(async () => {
		await viewer?.close();
		viewer = undefined;
	});

	test("replays a direct agent stream after a browser reload", async ({ page }) => {
		viewer = await openViewer(page, {
			scripts: {
				"smoke::hello::cursor::_": [
					{ type: "prompt" },
					{ type: "text", text: "Live answer before reload." },
					{ type: "wait", gate: "finish-direct" },
					{ type: "finish", passed: true, durationMs: 8 },
				],
			},
		});

		await startHello(page);
		await expect(liveSlot(page, "smoke", "hello")).toContainText("Live answer before reload.");
		await page.reload();
		await expect(liveSlot(page, "smoke", "hello")).toContainText("Live answer before reload.");
		await expect(page.locator("#live-connection")).toHaveText("Live updates connected.");

		viewer.gates.release("finish-direct");
		await expect(page.locator("#run-banner")).toContainText("Run finished. 1 passed.");
	});

	test("shows recovery, then resumes a second viewer without stale or duplicate activity", async ({
		page,
		context,
	}) => {
		viewer = await openViewer(page, {
			scripts: {
				"smoke::hello::cursor::_": [
					{ type: "prompt" },
					{ type: "text", text: "Keep this answer exactly once." },
					{ type: "wait", gate: "finish-reconnect" },
					{ type: "finish", passed: true, durationMs: 8 },
				],
			},
		});

		await startHello(page);
		const slot = liveSlot(page, "smoke", "hello");
		await expect(slot.getByText("Keep this answer exactly once.", { exact: true })).toBeVisible();

		const observer = await context.newPage();
		await observer.route("**/api/runs/*/events", (route) => route.abort());
		await observer.goto(viewer.url);
		await expect(observer.locator("#live-connection")).toHaveAttribute(
			"data-state",
			"reconnecting",
		);
		await observer.unroute("**/api/runs/*/events");
		await expect(observer.locator("#live-connection")).toHaveText("Live updates connected.", {
			timeout: 10_000,
		});
		await expect(
			liveSlot(observer, "smoke", "hello").getByText("Keep this answer exactly once.", {
				exact: true,
			}),
		).toHaveCount(1);

		viewer.gates.release("finish-reconnect");
		await expect(page.locator("#run-banner")).toContainText("Run finished. 1 passed.");
	});
});
