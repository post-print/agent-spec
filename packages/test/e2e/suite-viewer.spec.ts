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
			await expect(page.getByRole("heading", { name: "Suite viewer" })).toBeVisible();
			await expect(page.getByText("Run starts a live host agent.")).toBeVisible();
			await expect(page.getByRole("button", { name: "Run selection" })).toBeVisible();
			await expect(page.getByRole("button", { name: "Cancel run" })).toBeDisabled();
			await expect(page.locator("#run-banner")).toHaveText("");

			await expect(hostToggle(page, "cursor")).toBeChecked();
			await expect(hostToggle(page, "claude")).not.toBeChecked();
			await expect(hostToggle(page, "openai")).not.toBeChecked();
			await expect(page.locator("#parallel-hosts")).not.toBeChecked();

			await expect(page.getByRole("heading", { name: "smoke" })).toBeVisible();
			await expect(page.getByText("Minimal suite for the viewer.")).toBeVisible();
			await expect(page.getByRole("heading", { name: "judge" })).toBeVisible();
			await expect(page.getByText("Plain reply.")).toBeVisible();
			await expect(page.locator(".rubric-line").first()).toContainText("must smoke");
			await expect(page.locator(".rubric-line").first()).toContainText("judge");
			await expect(page.getByText("contextSources brief.md")).toBeVisible();
			await expect(page.getByText("Alpha workspace.")).toBeVisible();
			await expect(page.getByText("skeleton clean")).toBeVisible();

			const prompt = page.locator(".prompt-preview").first();
			await expect(prompt).toHaveText("Reply with smoke. <script>window.__xss=1</script>");
			expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
			expect(await page.locator("script[id='catalog-data']").count()).toBe(1);

			await expect(page.locator(".host-tablist").first()).toBeVisible();
			await expect(hostTab(page, "smoke", "hello", "cursor")).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(runCell(page, "smoke", "skipped", "cursor")).toBeDisabled();
			await expect(cellStatus(page, "smoke", "skipped", "cursor")).toHaveText("skip");
			await expect(hostTab(page, "smoke", "pinned", "cursor")).toBeDisabled();
			await expect(cellStatus(page, "smoke", "pinned", "cursor")).toHaveText("skip");
			await expect(runCell(page, "smoke", "pinned", "claude")).toBeEnabled();
			await expect(runCell(page, "smoke", "hello", "cursor")).toBeEnabled();
			await expect(liveRow(page, "smoke", "hello")).toBeHidden();
		});

		test("serves the catalog JSON and the index.html alias", async ({ page }) => {
			viewer = await openViewer(page);
			const catalog = await page.evaluate(async () => {
				const response = await fetch("/api/catalog");
				return { status: response.status, body: await response.json() };
			});
			expect(catalog.status).toBe(200);
			expect(catalog.body.defaultSelectedHosts).toEqual(["cursor"]);
			expect(catalog.body.suites.map((suite: { name: string }) => suite.name)).toEqual([
				"smoke",
				"judge",
			]);

			const index = await page.goto(new URL("index.html", viewer.url).href);
			expect(index?.status()).toBe(200);
			await expect(page.getByRole("heading", { name: "Suite viewer" })).toBeVisible();

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
			await runCell(page, "smoke", "hello", "cursor").click();
			expect((await posted).postDataJSON()).toEqual({
				suite: "smoke",
				scenario: "hello",
				hosts: ["cursor"],
				parallelHosts: false,
			});
			await expect(page.locator("#run-banner")).toContainText("started");
			await expect(page.getByRole("button", { name: "Cancel run" })).toBeEnabled();
			viewer.gates.release("mid");
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
			await expect(page.getByRole("button", { name: "Cancel run" })).toBeDisabled();
			expect(viewer.jobs).toEqual(["smoke::hello::cursor::_"]);
		});

		test("run row uses selected hosts and the parallel-hosts box", async ({ page }) => {
			viewer = await openViewer(page);
			await hostToggle(page, "cursor").uncheck();
			await hostToggle(page, "claude").check();
			await page.locator("#parallel-hosts").check();
			const posted = page.waitForRequest(
				(request) => request.url().includes("/api/runs") && request.method() === "POST",
			);
			await page.locator('button.run-row[data-suite="smoke"][data-scenario="hello"]').click();
			expect((await posted).postDataJSON()).toEqual({
				suite: "smoke",
				scenario: "hello",
				hosts: ["claude"],
				parallelHosts: true,
			});
			await expect(cellStatus(page, "smoke", "hello", "claude")).toHaveText("passed");
			expect(viewer.jobs).toEqual(["smoke::hello::claude::_"]);
		});

		test("run suite expands every runnable cell for selected hosts", async ({ page }) => {
			viewer = await openViewer(page);
			await page.locator('button.run-suite[data-suite="smoke"]').click();
			await expect(page.locator("#run-banner")).toContainText("2 passed");
			expect(viewer.jobs.sort()).toEqual(
				["smoke::context brief::cursor::_", "smoke::hello::cursor::_"].sort(),
			);
			await expect(cellStatus(page, "smoke", "skipped", "cursor")).toHaveText("skip");
			await expect(cellStatus(page, "smoke", "pinned", "cursor")).toHaveText("skip");
		});

		test("run selection with no host ticked still falls back to cursor", async ({ page }) => {
			viewer = await openViewer(page);
			await hostToggle(page, "cursor").uncheck();
			const posted = page.waitForRequest(
				(request) => request.url().includes("/api/runs") && request.method() === "POST",
			);
			await page.getByRole("button", { name: "Run selection" }).click();
			expect((await posted).postDataJSON()).toEqual({
				hosts: [],
				parallelHosts: false,
			});
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("passed");
			await expect(cellStatus(page, "smoke", "hello", "claude")).toHaveText("idle");
			expect(viewer.jobs.length).toBeGreaterThan(0);
			expect(viewer.jobs.every((job) => job.split("::")[2] === "cursor")).toBe(true);
		});

		test("blocks a second start from the page while a run is live", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": holdThenPass("hold"),
				},
			});
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(page.locator("#run-banner")).toContainText("started");
			await runCell(page, "smoke", "context brief", "cursor").click();
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
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			expect(viewer.jobs).toEqual(["smoke::hello::cursor::_", "smoke::hello::cursor::_"]);
			await expect(liveSlot(page, "smoke", "hello").locator(".bubble.role-user")).toHaveCount(1);
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
			await runCell(page, "smoke", "hello", "cursor").click();
			const slot = liveSlot(page, "smoke", "hello");
			await expect(liveRow(page, "smoke", "hello")).toBeVisible();
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("running");
			await expect(slot.locator(".live-status li")).toHaveText("Creating sealed workspace.");
			await expect(slot.locator(".context-path")).toHaveText("brief.md");
			await expect(slot.locator(".context-why")).toHaveText(
				"The scenario lists brief.md in contextSources.",
			);
			await expect(slot.locator(".bubble.role-context .bubble-text")).toContainText(
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
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Passed.");
			await expect(slot.locator(".cell-result-metrics")).toHaveText("2 turns · 40 tokens · 1 tool");
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
			await runCell(page, "smoke", "hello", "cursor").click();
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".live-status li")).toHaveText("Host login is missing.");
			await expect(slot.locator(".bubble.role-system .bubble-text")).toHaveText(
				"Host login is missing.",
			);
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("failed");
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveClass(/status-failed/);
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Failed.");
			await expect(slot.locator(".cell-result-failures li")).toHaveText("Host login is missing.");
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
			await runCell(page, "smoke", "hello", "cursor").click();
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Failed.");
			await expect(slot.locator(".cell-result-metrics")).toHaveText("1 turn · 12 tokens · 0 tools");
			await expect(slot.locator(".cell-result-failures li")).toHaveText(
				'Reply must contain "smoke".',
			);
			await expect(slot.locator(".cell-result-judges li")).toHaveText(
				"Fail. Was the reply useful? The reply ignored the prompt.",
			);
		});

		test("host tabs switch live panes and keep each result", async ({ page }) => {
			viewer = await openViewer(page);
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			const card = page.locator('[data-scenario-card="smoke::hello"]');
			await expect(card.locator('[data-host-panel="cursor"] .cell-result-verdict')).toHaveText(
				"Passed.",
			);
			await hostTab(page, "smoke", "hello", "claude").click();
			await expect(hostTab(page, "smoke", "hello", "claude")).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(card.locator('[data-host-panel="cursor"]')).toHaveAttribute("hidden", "");
			await expect(card.locator('[data-host-panel="claude"]')).not.toHaveAttribute("hidden");
			await expect(card.locator('[data-host-panel="claude"] .host-empty')).toHaveText(
				"No run yet.",
			);
			await expect(runCell(page, "smoke", "hello", "claude")).toBeEnabled();
			await runCell(page, "smoke", "hello", "claude").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(cellStatus(page, "smoke", "hello", "claude")).toHaveText("passed");
			await expect(card.locator('[data-host-panel="claude"] .cell-result-verdict')).toHaveText(
				"Passed.",
			);
			await hostTab(page, "smoke", "hello", "cursor").click();
			await expect(card.locator('[data-host-panel="cursor"] .cell-result-verdict')).toHaveText(
				"Passed.",
			);
			await expect(card.locator('[data-host-panel="claude"]')).toBeHidden();
		});

		test("marks a skipped finish and a runner throw", async ({ page }) => {
			viewer = await openViewer(page, {
				scripts: {
					"smoke::hello::cursor::_": [{ type: "finish", skipped: true, durationMs: 1 }],
					"smoke::context brief::cursor::_": [{ type: "throw", message: "spawn failed" }],
				},
			});
			await page.locator('button.run-suite[data-suite="smoke"]').click();
			await expect(cellStatus(page, "smoke", "hello", "cursor")).toHaveText("skipped");
			await expect(liveSlot(page, "smoke", "hello").locator(".cell-result-verdict")).toHaveText(
				"Skipped.",
			);
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(page.locator("#run-banner")).toContainText("1 skipped");
			await expect(page.locator("#run-banner")).toContainText("0 failed");
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
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(liveSlot(page, "smoke", "hello").locator(".chat-running")).toBeVisible();
			const cancel = page.waitForRequest(
				(request) => request.url().includes("/cancel") && request.method() === "POST",
			);
			await page.getByRole("button", { name: "Cancel run" }).click();
			expect((await cancel).url()).toMatch(/\/api\/runs\/run-\d+\/cancel$/);
			await expect(page.locator("#run-banner")).toContainText("Run cancelled.");
			await expect(page.getByRole("button", { name: "Cancel run" })).toBeDisabled();
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
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(liveSlot(page, "smoke", "hello").locator(".chat-running")).toBeVisible();
			await page.getByRole("button", { name: "Cancel run" }).click();
			await expect(page.locator("#run-banner")).toContainText("Run cancelled.");
			const slot = liveSlot(page, "smoke", "hello");
			await expect(slot.locator(".cell-result-verdict")).toHaveText("Cancelled.");
			viewer.gates.release("hold");
			await runCell(page, "smoke", "hello", "cursor").click();
			await expect(page.locator("#run-banner")).toContainText("Run finished.");
			await expect(slot.locator(".bubble.role-user")).toHaveCount(1);
			await expect(slot.locator(".bubble.role-assistant .bubble-text")).toHaveText("hello-again");
			await expect(slot.locator(".bubble.role-system")).toHaveCount(0);
		});
	});

	test.describe("compare", () => {
		test("shows two-arm chats side by side and names winners", async ({ page }) => {
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
			await runCell(page, "judge", "pair", "cursor").click();
			const slot = liveSlot(page, "judge", "pair");
			await expect(page.locator("#run-banner")).toContainText("2 passed");
			await expect(slot.locator(".compare-tablist")).toHaveCount(0);
			await expect(slot.locator(".live-cell")).toHaveCount(2);
			await expect(slot.locator(".live-cell").first()).toBeVisible();
			await expect(slot.locator(".live-cell").nth(1)).toBeVisible();
			await expect(slot.getByText("alpha-live")).toBeVisible();
			await expect(slot.getByText("beta-live")).toBeVisible();
			const winners = slot.locator(".compare-winners");
			await expect(winners.getByRole("heading", { name: "Winners" })).toBeVisible();
			await expect(winners.getByText("Turns: beta wins (2 vs 1).")).toBeVisible();
			await expect(winners.getByText("Tokens: beta wins (300 vs 200).")).toBeVisible();
			await expect(winners.getByText("Tools: tie (1 vs 1).")).toBeVisible();
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
			await runCell(page, "judge", "four arms", "cursor").click();
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
			await expect(page.locator("#run-banner")).toContainText("4 passed");
			await expect(slot.getByRole("tab", { name: "skeleton clean" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			await expect(slot.locator(".live-cell").filter({ hasText: "skel-clean-live" })).toBeVisible();
			await expect(slot.locator(".live-cell").filter({ hasText: "none-messy-live" })).toBeHidden();
			await expect(slot.getByRole("tab", { name: "skeleton clean" })).toHaveAttribute(
				"data-status",
				"passed",
			);
			await slot.getByRole("tab", { name: "no skill messy" }).click();
			await expect(slot.locator(".live-cell").filter({ hasText: "none-messy-live" })).toBeVisible();
			await expect(slot.locator(".live-cell").filter({ hasText: "skel-clean-live" })).toBeHidden();
			const winners = slot.locator(".compare-winners");
			await expect(
				winners.getByText("Turns: lowest is a tie between skeleton clean and skeleton messy"),
			).toBeVisible();
			await expect(winners.getByText("Tokens: lowest is skeleton clean")).toBeVisible();
			await expect(
				winners.getByText(
					"skeleton clean must use fewer turns than no skill messy (1 vs 3). Pass.",
				),
			).toBeVisible();
			await expect(
				winners.getByText(
					"skeleton clean must use fewer tokens than no skill clean (80 vs 200). Pass.",
				),
			).toBeVisible();
			await expect(winners.locator(".compare-winner-pass")).toHaveCount(3);
		});

		test("stacks two-arm chats on a narrow viewport", async ({ page }) => {
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
			await runCell(page, "judge", "pair", "cursor").click();
			const arms = liveSlot(page, "judge", "pair").locator(".compare-arms");
			await expect(arms).toBeVisible();
			const tracks = await arms.evaluate((node) => getComputedStyle(node).gridTemplateColumns);
			expect(tracks.split(/\s+/).filter(Boolean)).toHaveLength(1);
		});
	});

	test("rejects an empty run body from the API", async ({ page }) => {
		viewer = await openViewer(page);
		const empty = await postRuns(page, { suite: "missing" });
		expect(empty.status).toBe(400);
		expect(empty.body.error).toMatch(/No matching scenarios/i);
	});
});
