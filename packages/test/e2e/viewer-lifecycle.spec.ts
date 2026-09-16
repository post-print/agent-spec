import { expect, test } from "@playwright/test";
import { listenViewer } from "../src/viewer/server.js";
import { createGateBox, createScriptedRunner } from "./helpers/scripted-runner.js";

for (const cancel of [false, true]) {
	test(`comparison lifecycle with reload and ${cancel ? "cancellation" : "early verdict"}`, async ({
		page,
	}) => {
		const gates = createGateBox();
		const runner = createScriptedRunner({
			gates,
			scripts: {
				"lifecycle::other::cursor::_": [{ type: "wait", gate: "other" }, { type: "finish" }],
			},
		});
		const viewer = await listenViewer({
			cwd: process.cwd(),
			suitesDir: "/tmp/lifecycle",
			workers: 2,
			catalog: {
				suitesDir: "/tmp/lifecycle",
				defaultSelectedHosts: ["cursor"],
				suites: [
					{
						name: "lifecycle",
						hosts: ["cursor"],
						scenarios: [
							{
								name: "pair",
								prompt: "Compare",
								rubric: {},
								compare: [
									{ id: "a", label: "Alpha", rubric: {} },
									{ id: "b", label: "Beta", rubric: {} },
								],
							},
							{ name: "other", prompt: "Wait", rubric: {} },
						],
					},
				],
			},
			runner: {
				...runner,
				async finalizeCompare(input) {
					await gates.wait("judge");
					return {
						suite: input.suite,
						scenario: input.scenario.name,
						passed: true,
						failures: [],
						durationMs: 1,
					};
				},
			},
		});
		try {
			await page.goto(viewer.url);
			await page.locator("#run-selection").click();
			const nav = page.locator('[data-select-scenario="lifecycle::pair"]');
			const header = page.locator('[data-scenario-card="lifecycle::pair"] .focus-verdict');
			await expect(nav).toHaveAttribute("data-status", "judging");
			await expect(header).toHaveText("judging");
			await expect(page.locator(".run-arm-progress")).toHaveText("2 arms finished");
			await expect(
				page.getByText("Agent finished. Awaiting comparison verdict.", { exact: false }).first(),
			).toBeVisible();
			await expect(page.locator(".badge.status-passed")).toHaveCount(0);
			await page.reload();
			await expect(header).toHaveText("judging");
			await expect(page.locator(".run-arm-progress")).toHaveText("2 arms finished");
			if (cancel) {
				await page.getByRole("button", { name: "Stop run", exact: true }).click();
				await expect(header).toHaveText("cancelling");
				gates.release("judge");
				await expect(header).toHaveText("cancelled");
				await expect(nav).toHaveAttribute("data-status", "cancelled");
				await expect(page.locator(".badge.status-passed")).toHaveCount(0);
				await expect(
					page.getByText("Agent finished. Awaiting comparison verdict.", { exact: false }),
				).toHaveCount(0);
				await expect(page.locator(".run-progress-title")).toHaveText("0 of 2 tests finished");
				return;
			}
			gates.release("judge");
			await expect(header).toHaveText("passed");
			await expect(nav).toHaveAttribute("data-status", "passed");
			await expect(page.locator(".run-progress-title")).toHaveText("1 of 2 tests finished");
			await page.screenshot({ path: "/private/tmp/agent-viewer-lifecycle.png" });
			gates.release("other");
			await expect(page.locator(".run-progress-title")).toHaveText("2 of 2 tests finished");
		} finally {
			gates.release("judge");
			gates.release("other");
			await viewer.close();
		}
	});
}
