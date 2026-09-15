import { expect, type Page, test } from "@playwright/test";

import type { ScriptedStep } from "./helpers/scripted-runner.js";
import {
	cellStatus,
	hostTab,
	hostToggle,
	liveRow,
	liveSlot,
	openViewer,
	runCell,
	type ViewerHarness,
} from "./helpers/viewer.js";

const sealedRead = "/var/folders/f1/tmp/T/agent-harness-seal-abc/README.md";

function holdThenPass(gate: string, extras: ScriptedStep[] = []): ScriptedStep[] {
	return [{ type: "wait", gate }, ...extras, { type: "finish", passed: true, durationMs: 6 }];
}

async function postRuns(page: Page, body: unknown) {
	return page.evaluate(async (payload) => {
		const response = await fetch("/api/runs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		return { status: response.status, body: await response.json() };
	}, body);
}

async function focusScenario(page: Page, suite: string, scenario: string) {
	const key = `${suite}::${scenario}`;
	const picker = page.locator("#test-picker");
	if (await picker.isVisible()) {
		await picker.selectOption(key);
		return;
	}
	await page.locator(`[data-select-scenario="${key}"]`).click();
}

async function startCell(page: Page, suite: string, scenario: string, host: string) {
	await focusScenario(page, suite, scenario);
	await hostTab(page, suite, scenario, host).click();
	await runCell(page, suite, scenario, host).click();
}

test.describe("suite viewer", () => {
	let viewer: ViewerHarness | undefined;

	test.afterEach(async () => {
		await viewer?.close();
		viewer = undefined;
	});

	test.describe("catalog", () => {
		test("renders host tabs, host defaults, skip, pin, and escaped prompts", async ({ page }) => {
			viewer = await openViewer(page);
			await expect(page).toHaveTitle("agent-test viewer");
			await expect(page.getByRole("heading", { name: "Test viewer" })).toBeVisible();
			await expect(page.locator("#run-banner")).toHaveText("Choose a test to inspect or run.");
			await expect(page.locator("#run-selection")).toBeDisabled();
			await expect(page.getByRole("button", { name: "Start run" })).toBeDisabled();
			await expect(page.locator(".run-settings")).toHaveCount(0);
			await expect(page.locator(".viewer-command-row .host-toggles")).toBeVisible();
			await expect(page.locator("#run-progress")).toBeHidden();

			await expect(hostToggle(page, "cursor")).not.toBeChecked();
			await expect(hostToggle(page, "claude")).not.toBeChecked();
			await expect(hostToggle(page, "openai")).not.toBeChecked();
			await expect(page.locator("#parallel-hosts")).toBeChecked();

			await expect(page.getByRole("heading", { name: "smoke" })).toBeVisible();
			await expect(
				page.locator('[data-scenario-card="smoke::hello"] .suite-description'),
			).toHaveText("Minimal suite for the viewer.");
			await expect(page.getByRole("heading", { name: "judge", exact: true })).toBeVisible();
			await expect(page.locator('[data-scenario-card="smoke::hello"] .scenario-lede')).toHaveText(
				"Plain reply.",
			);
			await expect(page.locator(".criterion-groups").first()).toContainText(
				"Final reply must include smoke.",
			);
			await expect(page.locator(".criterion-groups").first()).toContainText("Judge");
			await focusScenario(page, "smoke", "context brief");
			const providedContext = page.locator(
				'[data-scenario-card="smoke::context brief"] .test-intent',
			);
			await expect(providedContext).toBeVisible();
			await expect(providedContext.locator(".task-meta-label")).toHaveText("Provided context");
			await expect(providedContext.getByText("brief.md", { exact: true })).toBeVisible();
			await expect(
				page.locator('[data-scenario-card="smoke::context brief"] .criteria-panel'),
			).not.toContainText("Provided context");
			await focusScenario(page, "judge", "pair");
			const pairDefinition = page.locator('[data-scenario-card="judge::pair"] .compare-definition');
			await expect(pairDefinition.getByRole("tablist")).toBeVisible();
			await expect(pairDefinition.getByText("Alpha workspace.")).toBeVisible();
			await expect(pairDefinition.getByText("Beta workspace.")).toBeHidden();
			await pairDefinition.locator("label.compare-definition-tab", { hasText: "beta" }).click();
			await expect(pairDefinition.getByText("Beta workspace.")).toBeVisible();
			await expect(pairDefinition.getByText("Alpha workspace.")).toBeHidden();
			await focusScenario(page, "judge", "four arms");
			await expect(
				page.getByRole("heading", { name: "skeleton clean", exact: true }),
			).toBeVisible();

			const prompt = page.locator(".prompt-preview").first();
			await expect(prompt).toHaveText("Reply with smoke. <script>window.__xss=1</script>");
			expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
			expect(await page.locator("script[id='catalog-data']").count()).toBe(1);

			await focusScenario(page, "smoke", "hello");
			await expect(page.locator('[data-scenario-card="smoke::hello"] .host-tablist')).toBeVisible();
			await expect(hostTab(page, "smoke", "hello", "cursor")).toHaveAttribute(
				"aria-selected",
				"false",
			);
			await expect(
				page.locator('[data-scenario-card="smoke::skipped"] button.run-cell'),
			).toBeDisabled();
			await expect(cellStatus(page, "smoke", "skipped", "cursor")).toHaveText("skip");
			await expect(hostTab(page, "smoke", "pinned", "cursor")).toBeDisabled();
			await expect(cellStatus(page, "smoke", "pinned", "cursor")).toHaveText("skip");
			await expect(runCell(page, "smoke", "pinned", "claude")).toBeEnabled();
			await expect(
				page.locator('[data-scenario-card="smoke::hello"] button.run-cell'),
			).toBeDisabled();
			await expect(liveRow(page, "smoke", "hello")).toBeHidden();
		});

		test("serves the catalog JSON and the index.html alias", async ({ page }) => {
			viewer = await openViewer(page);
			const catalog = await page.evaluate(async () => {
				const response = await fetch("/api/catalog");
				return { status: response.status, body: await response.json() };
			});
			expect(catalog.status).toBe(200);
			expect(catalog.body.defaultSelectedHosts).toEqual([]);
			expect(catalog.body.suites.map((suite: { name: string }) => suite.name)).toEqual([
				"smoke",
				"judge",
			]);

			const index = await page.goto(new URL("index.html", viewer.url).href);
			expect(index?.status()).toBe(200);
			await expect(page.getByRole("heading", { name: "Test viewer" })).toBeVisible();

			const missing = await page.goto(new URL("missing", viewer.url).href);
			expect(missing?.status()).toBe(404);
		});
	});

	test.describe("run scope", () => {
		test("posts a single cell with that host only", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": holdThenPass("mid"),
				},
			});
			const posted = page.waitForRequest(
				(request) => request.url().includes("/api/runs") && request.method() === "POST",
			);
			await startCell(page, "smoke", "hello", "cursor");
			expect((await posted).postDataJSON()).toEqual({
				suite: "smoke",
				scenario: "hello",
				hosts: ["cursor"],
				parallelHosts: false,
			});
			await expect(page.locator("#run-banner")).toContainText("started");
			await expect(page.getByRole("button", { name: "Stop test" })).toBeEnabled();
			viewer.gates.release("mid");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
			await expect(page.getByRole("button", { name: "Start test" })).toBeEnabled();
			expect(viewer.jobs).toEqual(["smoke::hello::cursor::_"]);
		});

		test("start run uses selected hosts and runs them together by default", async ({ page }) => {
			viewer = await openViewer(page);
			await hostToggle(page, "cursor").uncheck();
			await hostToggle(page, "claude").check();
			await focusScenario(page, "smoke", "hello");
			await expect(hostTab(page, "smoke", "hello", "claude")).toBeVisible();
			await expect(hostTab(page, "smoke", "hello", "claude")).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(hostTab(page, "smoke", "hello", "cursor")).toBeHidden();
			await expect(hostTab(page, "smoke", "hello", "openai")).toBeHidden();
			const posted = page.waitForRequest(
				(request) => request.url().includes("/api/runs") && request.method() === "POST",
			);
			await page.locator("#run-selection").click();
			expect((await posted).postDataJSON()).toEqual({
				hosts: ["claude"],
				parallelHosts: true,
			});
			await expect(cellStatus(page, "smoke", "hello", "claude")).toHaveText("passed");
			expect(viewer.jobs).toContain("smoke::hello::claude::_");
			expect(viewer.jobs.every((job) => job.includes("::claude::"))).toBe(true);
		});

		test("run suite expands every runnable cell for selected hosts", async ({ page }) => {
			viewer = await openViewer(page);
			await hostToggle(page, "cursor").check();
			await page.locator('button.run-suite[data-suite="smoke"]').click();
			await expect(page.locator("#run-banner")).toContainText("2 passed");
			expect(viewer.jobs.sort()).toEqual(
				["smoke::context brief::cursor::_", "smoke::hello::cursor::_"].sort(),
			);
			await expect(cellStatus(page, "smoke", "skipped", "cursor")).toHaveText("skip");
			await expect(cellStatus(page, "smoke", "pinned", "cursor")).toHaveText("skip");
		});

		test("shows finished, passed, failed, skipped, and remaining counts", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "wait", gate: "finish-first" },
						{ type: "finish", passed: true, durationMs: 4 },
					],
					"smoke::context brief::cursor::_": [
						{
							type: "finish",
							passed: false,
							durationMs: 4,
							failures: [{ matcher: "toContain", message: "The expected text was missing." }],
						},
					],
				},
			});
			await hostToggle(page, "cursor").check();
			await page.locator('button.run-suite[data-suite="smoke"]').click();
			const progress = page.locator("#run-progress");
			await expect(progress).toBeVisible();
			await expect(progress.locator(".run-progress-title")).toHaveText("1 of 2 tests finished");
			await expect(progress.locator(".progress-passed strong")).toHaveText("0");
			await expect(progress.locator(".progress-failed strong")).toHaveText("1");
			await expect(progress.locator(".progress-skipped strong")).toHaveText("0");
			await expect(progress.locator(".progress-remaining strong")).toHaveText("1");
			viewer.gates.release("finish-first");
			await expect(progress.locator(".run-progress-title")).toHaveText("2 of 2 tests finished");
			await expect(progress.locator(".progress-passed strong")).toHaveText("1");
			await expect(progress.locator(".progress-failed strong")).toHaveText("1");
			await expect(progress.locator(".progress-remaining strong")).toHaveText("0");
			await expect(progress.locator(".run-progress-track")).toHaveAttribute("aria-valuenow", "2");
		});

		test("requires an explicit host before running a selection", async ({ page }) => {
			viewer = await openViewer(page);
			await expect(page.locator("#run-selection")).toBeDisabled();
			await expect(page.locator('button.run-suite[data-suite="smoke"]')).toBeDisabled();
			await hostToggle(page, "openai").check();
			await expect(page.locator("#run-selection")).toBeEnabled();
			await expect(page.locator('button.run-suite[data-suite="smoke"]')).toBeEnabled();
			expect(viewer.jobs).toEqual([]);
		});

		test("blocks a second start from the page while a run is live", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": holdThenPass("hold"),
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			await expect(page.locator("#run-banner")).toContainText("started");
			await startCell(page, "smoke", "context brief", "cursor");
			await expect(page.locator("#run-banner")).toHaveText(
				"A run is already in progress. Cancel it first.",
			);
			const conflict = await postRuns(page, {
				suite: "smoke",
				scenario: "hello",
				hosts: ["cursor"],
			});
			expect(conflict.status).toBe(409);
			expect(conflict.body.error).toMatch(/already in progress/i);
			viewer.gates.release("hold");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
		});

		test("can start another run after the first run finishes", async ({ page }) => {
			viewer = await openViewer(page);
			await startCell(page, "smoke", "hello", "cursor");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await startCell(page, "smoke", "hello", "cursor");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			expect(viewer.jobs).toEqual(["smoke::hello::cursor::_", "smoke::hello::cursor::_"]);
			await expect(liveSlot(page, "smoke", "hello").locator(".bubble.role-user")).toHaveCount(1);
		});

		test("keeps an older run selected while a newer run continues", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::context brief::cursor::_": holdThenPass("newer"),
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			const history = page.locator("#run-history");
			const olderRunId = await history.inputValue();

			await startCell(page, "smoke", "context brief", "cursor");
			await expect(page.locator("#run-banner")).toContainText("started");
			await history.selectOption(olderRunId);
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
			await expect(history.locator("option", { hasText: "running" })).toHaveCount(1);

			viewer.gates.release("newer");
			await expect(history.locator("option", { hasText: "completed" })).toHaveCount(2);
			await expect(history).toHaveValue(olderRunId);
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
		});
	});

	test.describe("live chat", () => {
		test("streams status, context, prompt, text, tools, and the running mark", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "status", text: "Creating sealed workspace." },
						{
							type: "context",
							mode: "harness-preamble",
							hostInput: "Injected context\n\n---\nTask:\nReply with smoke.",
							files: [
								{
									path: "brief.md",
									text: "DEPTH_CONTEXT token: agent-test-e2e-context",
									reason: "contextSources",
									why: "The scenario lists brief.md in contextSources.",
								},
							],
						},
						{ type: "prompt" },
						{ type: "wait", gate: "after-prompt" },
						{ type: "text", text: "Hel" },
						{ type: "wait", gate: "after-partial" },
						{ type: "text", text: "Hello from the agent" },
						{
							type: "tool",
							name: "Read",
							args: { path: sealedRead, command: "not-a-path\nsecond line" },
						},
						{ type: "wait", gate: "after-tool" },
						{ type: "text", text: "Done." },
						{
							type: "finish",
							passed: true,
							durationMs: 12,
							metrics: { turns: 2, tokens: 40, tools: 1 },
						},
					],
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			const slot = liveSlot(page, "smoke", "hello");
			await expect(liveRow(page, "smoke", "hello")).toBeVisible();
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("running");
			await expect(slot.locator(".live-status li")).toHaveText("Creating sealed workspace.");
			await expect(slot.locator(".context-panel")).toBeVisible();
			await expect(slot.locator(".context-panel-title")).toHaveText("Context delivery");
			await expect(slot.locator(".context-panel-count")).toHaveText("Harness preamble · 1 file");
			await expect(slot.locator(".context-flow")).toContainText("Scenario");
			await expect(slot.locator(".context-host-input")).toContainText("Exact submitted user input");
			await expect(slot.locator(".context-host-input")).toContainText("Reply with smoke.");
			await expect(slot.locator(".context-path")).toHaveText("brief.md");
			await expect(slot.locator(".context-why")).toHaveText(
				"The scenario lists brief.md in contextSources.",
			);
			await expect(slot.locator(".context-file .context-body")).toContainText(
				"agent-test-e2e-context",
			);
			await expect(slot.locator(".bubble.role-user .bubble-text")).toContainText(
				"Reply with smoke.",
			);
			await expect(slot.locator(".chat-running")).toBeVisible();

			viewer.gates.release("after-prompt");
			await expect(slot.locator(".bubble.role-assistant .bubble-text")).toHaveText("Hel");
			await expect(slot.locator(".bubble.role-assistant")).toHaveClass(/is-streaming/);
			await expect(slot.locator(".chat-running-row")).toHaveCount(0);

			viewer.gates.release("after-partial");
			await expect(slot.locator(".bubble.role-assistant .bubble-text")).toHaveText(
				"Hello from the agent",
			);
			await expect(slot.locator(".tool-name")).toHaveText("Read");
			await expect(slot.locator(".tool-arg code").first()).toHaveText("README.md");
			await expect(slot.locator(".tool-arg code").first()).toHaveAttribute("title", sealedRead);
			await expect(slot.locator(".tool-arg code").nth(1)).toContainText("↵");
			await expect(slot.locator(".chat-running")).toBeVisible();
			await expect(slot.locator(".bubble.role-assistant").first()).not.toHaveClass(/is-streaming/);

			viewer.gates.release("after-tool");
			await expect(slot.locator(".bubble.role-assistant .bubble-text").last()).toHaveText("Done.");
			await expect(page.locator("#run-banner")).toContainText("1 passed");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveClass(/status-passed/);
			await expect(slot.locator(".chat-running-row")).toHaveCount(0);
			await expect(slot.locator(".bubble.is-streaming")).toHaveCount(0);
			await expect(slot.locator(".badge")).toHaveText("passed");
			await expect(slot.locator(".tokens")).toHaveText("40 tokens");
			await expect(slot.locator(".scenario-meta h3", { hasText: "Trace stats" })).toHaveCount(1);
		});

		test("renders a host error in the live row and marks the cell failed", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "error", message: "Host login is missing." },
						{
							type: "finish",
							passed: false,
							durationMs: 3,
							failures: [{ matcher: "liveScenario", message: "Host login is missing." }],
						},
					],
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".bubble.role-system .bubble-text")).toHaveText(
				"Host login is missing.",
			);
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("failed");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveClass(/status-failed/);
			await expect(slot.locator(".badge")).toHaveText("failed");
			await expect(slot.locator(".failure-message")).toHaveText("Host login is missing.");
			await expect(page.locator("#run-banner")).toContainText("1 failed");
		});

		test("lists the rubric failure under a failed run", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "prompt" },
						{ type: "text", text: "nope" },
						{
							type: "finish",
							passed: false,
							durationMs: 9,
							metrics: { turns: 1, tokens: 12, tools: 0 },
							failures: [{ matcher: "must", message: 'Reply must contain "smoke".' }],
						},
						{
							type: "judge",
							verdicts: [
								{
									id: "useful",
									question: "Was the reply useful?",
									pass: false,
									rationale: "The reply ignored the prompt.",
								},
							],
						},
					],
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".badge")).toHaveText("failed");
			await expect(slot.locator(".tokens")).toHaveText("12 tokens");
			await expect(slot.locator(".failure-message")).toHaveText('Reply must contain "smoke".');
			await expect(slot.locator(".verdict-fail .question")).toContainText("Was the reply useful?");
			await expect(slot.locator(".verdict-fail .rationale")).toHaveText(
				"The reply ignored the prompt.",
			);
		});

		test("host tabs switch live panes and keep each result", async ({ page }) => {
			viewer = await openViewer(page);
			await hostToggle(page, "cursor").check();
			await hostToggle(page, "claude").check();
			await page.locator("#run-selection").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await focusScenario(page, "smoke", "hello");
			const card = page.locator('[data-scenario-card="smoke::hello"]');
			await expect(card.locator('[data-host-panel="cursor"] .badge')).toHaveText("passed");
			await hostTab(page, "smoke", "hello", "claude").click();
			await expect(hostTab(page, "smoke", "hello", "claude")).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(card.locator('[data-host-panel="cursor"]')).toHaveAttribute("hidden", "");
			await expect(card.locator('[data-host-panel="claude"]')).not.toHaveAttribute("hidden");
			await expect(cellStatus(page, "smoke", "hello", "claude")).toHaveText("passed");
			await expect(card.locator('[data-host-panel="claude"] .badge')).toHaveText("passed");
			await hostTab(page, "smoke", "hello", "cursor").click();
			await expect(card.locator('[data-host-panel="cursor"] .badge')).toHaveText("passed");
			await expect(card.locator('[data-host-panel="claude"]')).toBeHidden();
		});

		test("marks a skipped finish and a runner throw", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [{ type: "finish", skipped: true, durationMs: 1 }],
					"smoke::context brief::cursor::_": [{ type: "throw", message: "spawn failed" }],
				},
			});
			await hostToggle(page, "cursor").check();
			await page.locator('button.run-suite[data-suite="smoke"]').click();
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("skipped");
			await expect(liveSlot(page, "smoke", "hello").locator(".badge")).toHaveText("skipped");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(page.locator("#run-banner")).toContainText("1 skipped");
			await expect(page.locator("#run-banner")).toContainText("1 failed");
		});

		test("cancels a held run and ends the banner", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "prompt" },
						{ type: "wait", gate: "hold" },
						{ type: "finish", passed: true, durationMs: 6 },
					],
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			await expect(liveSlot(page, "smoke", "hello").locator(".chat-running")).toBeVisible();
			const cancel = page.waitForRequest(
				(request) => request.url().includes("/cancel") && request.method() === "POST",
			);
			await page.getByRole("button", { name: "Stop test" }).click();
			expect((await cancel).url()).toMatch(/\/api\/runs\/run-\d+\/cancel$/);
			await expect(page.locator("#run-banner")).toContainText("Run cancelled.");
			await expect(page.getByRole("button", { name: "Start test" })).toBeEnabled();
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".chat-running-row")).toHaveCount(0);
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Cancelled.");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("cancelled");
		});

		test("a new run after cancel starts a fresh chat", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [
						{ type: "prompt" },
						{ type: "wait", gate: "hold" },
						{ type: "text", text: "hello-again" },
						{ type: "finish", passed: true, durationMs: 6 },
					],
				},
			});
			await startCell(page, "smoke", "hello", "cursor");
			await expect(liveSlot(page, "smoke", "hello").locator(".chat-running")).toBeVisible();
			await page.getByRole("button", { name: "Stop test" }).click();
			await expect(page.locator("#run-banner")).toContainText("Run cancelled.");
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Cancelled.");
			viewer.gates.release("hold");
			await startCell(page, "smoke", "hello", "cursor");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(slot.locator(".bubble.role-user")).toHaveCount(1);
			await expect(slot.locator(".bubble.role-assistant .bubble-text")).toHaveText("hello-again");
			await expect(slot.locator(".bubble.role-system")).toHaveCount(0);
		});
	});

	test.describe("compare", () => {
		test("uses the completed two-arm report layout and names winners", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"judge::pair::cursor::a": [
						{ type: "prompt" },
						{ type: "text", text: "alpha-live" },
						{ type: "finish", passed: true, metrics: { turns: 2, tokens: 300, tools: 1 } },
					],
					"judge::pair::cursor::b": [
						{ type: "prompt" },
						{ type: "text", text: "beta-live" },
						{ type: "finish", passed: true, metrics: { turns: 1, tokens: 200, tools: 1 } },
					],
				},
			});
			await focusScenario(page, "judge", "pair");
			const definition = page.locator('[data-scenario-card="judge::pair"] .scenario-definition');
			await expect(definition.getByText("Comparison pass criteria", { exact: true })).toBeVisible();
			await expect(definition.getByText("alpha must pass all of its criteria.")).toBeVisible();
			await expect(definition.getByText("beta must pass all of its criteria.")).toBeVisible();
			const alphaDefinition = definition.locator('[data-compare-arm-definition="a"]');
			await expect(alphaDefinition.getByText("Task", { exact: true })).toBeVisible();
			await expect(alphaDefinition.getByText("Read word.txt. Reply alpha.")).toBeVisible();
			await expect(alphaDefinition.getByText("Pass criteria", { exact: true })).toBeVisible();
			await expect(alphaDefinition.getByText("Final reply must include")).toBeVisible();
			await startCell(page, "judge", "pair", "cursor");
			const slot = liveSlot(page, "judge", "pair");
			await expect(page.locator("#run-banner")).toContainText("1 passed");
			await expect(slot.locator(".compare-tablist")).toBeVisible();
			await expect(slot.locator(".compare-tab")).toHaveCount(2);
			await expect(slot.locator(".compare-arm")).toHaveCount(2);
			await expect(slot.locator("details.trace-details[open]:visible")).toHaveCount(1);
			await expect(slot.getByText("alpha-live", { exact: true })).toBeVisible();
			await expect(slot.getByText("beta-live", { exact: true })).toBeHidden();
			await slot.locator("label.compare-tab", { hasText: "beta" }).click();
			await expect(slot.getByText("beta-live", { exact: true })).toBeVisible();
			await expect(slot.getByText("alpha-live", { exact: true })).toBeHidden();
			await expect(
				slot.getByText("Lower is better: green is lowest and red is highest."),
			).toBeVisible();
			await expect(slot.locator(".compare-table td.is-better")).toHaveCount(2);
		});

		test("uses tabs for four arms and keeps a user-picked tab", async ({ page }) => {
			const metrics = {
				"skel-clean": { turns: 1, tokens: 80, tools: 1 },
				"none-clean": { turns: 2, tokens: 200, tools: 1 },
				"skel-messy": { turns: 1, tokens: 90, tools: 1 },
				"none-messy": { turns: 3, tokens: 220, tools: 2 },
			};
			const scripts = Object.fromEntries(
				Object.entries(metrics).map(([arm, values]) => [
					`judge::four arms::cursor::${arm}`,
					[
						{ type: "wait", gate: `start:${arm}` },
						{ type: "prompt" },
						{ type: "text", text: `${arm}-live` },
						{ type: "finish", passed: true, metrics: values },
					] satisfies ScriptedStep[],
				]),
			);
			viewer = await openViewer(page, { scripts });
			await startCell(page, "judge", "four arms", "cursor");
			const slot = liveSlot(page, "judge", "four arms");
			await expect(slot.locator(".compare-tablist")).toBeVisible();
			await expect(slot.locator(".compare-tab")).toHaveCount(4);
			await slot.getByRole("tab", { name: "skeleton clean" }).click();
			await expect(slot.getByRole("tab", { name: "skeleton clean" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			for (const arm of Object.keys(metrics)) {
				viewer.gates.release(`start:${arm}`);
			}
			await expect(page.locator("#run-banner")).toContainText("1 passed");
			await expect(slot.locator('[data-arm-id="skel-clean"]')).toBeVisible();
			await expect(slot.locator('[data-arm-id="none-messy"]')).toBeHidden();
			await slot.locator("label.compare-tab", { hasText: "no skill messy" }).click();
			await expect(slot.locator('[data-arm-id="none-messy"]')).toBeVisible();
			await expect(slot.locator('[data-arm-id="skel-clean"]')).toBeHidden();
			const criteria = slot.locator(".story-criteria");
			await expect(
				slot.getByText("Lower is better: green is lowest and red is highest."),
			).toBeVisible();
			await expect(
				slot.locator(".compare-table tr", { hasText: "Tokens" }).locator("td.is-better"),
			).toHaveCount(1);
			await expect(
				criteria.getByText("skeleton clean must use fewer turns than no skill messy"),
			).toBeVisible();
			await expect(
				criteria.getByText("skeleton clean must use fewer tokens than no skill clean"),
			).toBeVisible();
			await expect(criteria.getByRole("heading", { name: "Pass criteria" })).toBeVisible();
			await expect(slot.getByText("Decision checks")).toHaveCount(0);
		});

		test("stacks both completed arms on a narrow viewport", async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			viewer = await openViewer(page, {
				scripts: {
					"judge::pair::cursor::a": [
						{ type: "text", text: "alpha-live" },
						{ type: "finish", passed: true, metrics: { turns: 1, tokens: 10, tools: 0 } },
					],
					"judge::pair::cursor::b": [
						{ type: "text", text: "beta-live" },
						{ type: "finish", passed: true, metrics: { turns: 1, tokens: 10, tools: 0 } },
					],
				},
			});
			await startCell(page, "judge", "pair", "cursor");
			const arms = liveSlot(page, "judge", "pair").locator(".compare-arms");
			await expect(arms).toBeVisible();
			const tracks = await arms.evaluate((node) => getComputedStyle(node).gridTemplateColumns);
			expect(tracks.split(/\s+/).filter(Boolean)).toHaveLength(1);
			await expect(arms.locator(".compare-arm:visible")).toHaveCount(1);
			await liveSlot(page, "judge", "pair")
				.locator("label.compare-tab", { hasText: "beta" })
				.click();
			await expect(arms.locator('[data-arm-id="b"]')).toBeVisible();
		});
	});

	test("rejects an empty run body from the API", async ({ page }) => {
		viewer = await openViewer(page);
		const empty = await postRuns(page, { suite: "missing" });
		expect(empty.status).toBe(400);
		expect(empty.body.error).toMatch(/No matching scenarios/i);
	});
});
