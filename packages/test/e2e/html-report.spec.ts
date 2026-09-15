import { expect, test } from "@playwright/test";

import { e2eReports, openReport, type ReportHarness, scenarioDetails } from "./helpers/report.js";

async function focusReportScenario(page: import("@playwright/test").Page, name: string) {
	const target = page.locator("[data-select-scenario]", { hasText: name }).first();
	const key = await target.getAttribute("data-select-scenario");
	const picker = page.locator("#test-picker");
	if (await picker.isVisible()) {
		await picker.selectOption(key ?? "");
		return;
	}
	await target.click();
}

test.describe("html report preview", () => {
	let report: ReportHarness | undefined;

	test.afterEach(async () => {
		await report?.close();
		report = undefined;
	});

	test("renders verdict, guide, cost, and both hosts", async ({ page }) => {
		report = await openReport(page);
		await expect(page).toHaveTitle("agent-test report");
		await expect(page.getByRole("heading", { name: "Run report" })).toBeVisible();
		await expect(page.locator(".lede")).toContainText("cursor, claude");
		await expect(page.locator(".lede")).toContainText("e2e-suites");
		await expect(page.locator(".when")).toContainText("2026-09-14T18:00:00.000Z");
		await expect(page.locator(".stat-pass strong")).toHaveText("6");
		await expect(page.locator(".stat-fail strong")).toHaveText("2");
		await expect(page.locator(".stat-skip strong")).toHaveText("1");
		await expect(page.getByRole("heading", { name: "How to read this report" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "Token cost" })).toBeVisible();
		await expect(page.getByText("Typical", { exact: true })).toBeVisible();
		await expect(page.getByText("Largest", { exact: true })).toBeVisible();
		await expect(page.getByText("Tokens are cost, not the verdict.")).toBeVisible();
	});

	test("opens completed scenarios and keeps skipped scenarios closed", async ({ page }) => {
		report = await openReport(page);
		const hello = scenarioDetails(page, "hello");
		const broken = scenarioDetails(page, "broken");
		const later = scenarioDetails(page, "later");
		const pair = scenarioDetails(page, "pair");
		await expect(hello).toHaveAttribute("open", "");
		await expect(broken).toHaveAttribute("open", "");
		await expect(later).not.toHaveAttribute("open", "");
		await expect(pair).toHaveAttribute("open", "");
		await expect(later.locator(".badge")).toHaveText("skipped");
		await expect(broken.locator(".badge")).toHaveText("failed");

		await focusReportScenario(page, "hello");
		await expect(hello.getByText("1,234 tokens")).toBeVisible();
		await expect(hello.getByText("Context delivery")).toBeVisible();
		await expect(hello.locator(".context-path")).toHaveText("brief.md");
		await expect(hello.getByText("DEPTH_CONTEXT token: agent-test-e2e-context")).toBeVisible();
		await expect(hello.getByText("Pass criteria")).toBeVisible();
		await expect(hello.getByText('reply includes "smoke"')).toBeVisible();
		await expect(hello.getByText("medium")).toBeVisible();
		await expect(hello.getByText("skeleton")).toBeVisible();
		await hello.locator(":scope > summary").click();
		await expect(hello).not.toHaveAttribute("open", "");
	});

	test("keeps streamed markup escaped and shortens sealed tool paths", async ({ page }) => {
		report = await openReport(page);
		const hello = scenarioDetails(page, "hello");
		await expect(hello.locator("details.trace-details")).toHaveAttribute("open", "");
		await expect(
			hello.getByText("Reply with smoke. <script>window.__xss=1</script>").first(),
		).toBeVisible();
		expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
		await expect(hello.locator(".tool-name")).toHaveText("Read");
		await expect(hello.locator(".tool-arg code")).toHaveText("README.md");
		await expect(hello.locator(".tool-arg code")).toHaveAttribute(
			"title",
			"/var/folders/f1/tmp/T/agent-harness-seal-abc/README.md",
		);
	});

	test("shows judge, story, failures, empty traces, and grouped legacy chats", async ({ page }) => {
		report = await openReport(page);
		const broken = scenarioDetails(page, "broken");
		await focusReportScenario(page, "broken");
		await expect(broken.locator(".question")).toContainText("Was the reply helpful?");
		await expect(broken.locator(".rationale")).toHaveText("Too curt & vague");
		await expect(broken.locator(".judge-evidence")).toContainText("CONFLICT WEBHOOK");
		await broken.getByText("Judge conversation").click();
		await expect(broken.locator(".judge-input")).toContainText("Criterion: Was the reply helpful?");
		await expect(broken.locator(".judge-response")).toContainText('"verdict":"no"');
		await expect(broken.getByText("plain two papers")).toBeVisible();
		await expect(broken.locator(".story-check-fail")).toContainText('reply omits "WEBHOOK"');
		await expect(broken.locator("details.trace-details")).toHaveAttribute("open", "");
		await expect(broken.getByText("echo hi")).toBeVisible();

		const mismatch = scenarioDetails(page, "mismatch");
		await focusReportScenario(page, "mismatch");
		await expect(mismatch).toHaveAttribute("open", "");
		await expect(mismatch.getByText("Missing requirement")).toBeVisible();
		await expect(mismatch.getByText("missing <b>tag</b>")).toBeVisible();
		await expect(mismatch.getByText("assistant text omitted the required phrase")).toBeVisible();

		const empty = scenarioDetails(page, "no-trace");
		await focusReportScenario(page, "no-trace");
		await expect(empty.locator("details.trace-details")).toHaveAttribute("open", "");
		await expect(empty.getByText("No transcript recorded for this scenario.")).toBeVisible();

		const legacy = scenarioDetails(page, "legacy");
		await focusReportScenario(page, "legacy");
		await expect(legacy.locator("details.trace-details")).toHaveAttribute("open", "");
		await expect(legacy.getByText("Emission order wasn't recorded")).toBeVisible();
		await expect(legacy.getByText("Legacy trace message")).toBeVisible();
		await expect(legacy.getByRole("heading", { name: "Tool calls" })).toBeVisible();
	});

	test("shows two-arm chats side by side with comparison winners", async ({ page }) => {
		report = await openReport(page);
		const pair = scenarioDetails(page, "pair");
		await focusReportScenario(page, "pair");
		await expect(pair.locator('[role="tablist"]')).toBeVisible();
		await expect(pair.locator("label.compare-tab")).toHaveCount(2);
		await expect(pair.locator('[data-arm-id="a"]')).toBeVisible();
		await expect(pair.locator('[data-arm-id="b"]')).toBeHidden();
		await expect(pair.locator("details.trace-details[open]:visible")).toHaveCount(1);
		await expect(pair.getByText("alpha-compare-a7c1")).toBeVisible();
		await expect(pair.locator('[data-arm-id="a"] .context-body')).toContainText(
			"alpha workspace word",
		);
		await expect(pair.getByText("beta-compare-b3e9")).toBeHidden();
		await expect(pair.getByText("Arm A")).toBeVisible();
		await pair.locator("label.compare-tab", { hasText: "beta" }).click();
		await expect(pair.getByText("beta-compare-b3e9")).toBeVisible();
		await expect(pair.locator('[data-arm-id="b"] .context-body')).toContainText(
			"beta workspace word",
		);
		await expect(pair.getByText("alpha-compare-a7c1")).toBeHidden();
		await expect(pair.getByText("Arm B")).toBeVisible();
		await expect(pair.getByRole("heading", { name: "Comparison metrics" })).toBeVisible();
		await expect(
			pair.getByText("Lower is better: green is lowest and red is highest."),
		).toBeVisible();
		await expect(pair.locator(".compare-table")).toContainText("Turns");
		await expect(pair.locator('.compare-table tr:has-text("Duration")')).toHaveCount(0);
		const columns = await pair.locator(".compare-arms").evaluate((node) => {
			return getComputedStyle(node).gridTemplateColumns;
		});
		expect(columns.split(/\s+/).filter(Boolean)).toHaveLength(1);
	});

	test("switches n-arm report tabs and lists named winners", async ({ page }) => {
		report = await openReport(page);
		const four = scenarioDetails(page, "four arms");
		await focusReportScenario(page, "four arms");
		await expect(four.locator('[role="tablist"]')).toBeVisible();
		await expect(four.locator('[data-arm-id="skel-clean"]')).toBeVisible();
		await expect(four.locator('[data-arm-id="skel-clean"] details.trace-details')).toHaveAttribute(
			"open",
			"",
		);
		await expect(four.getByText("skel-clean-ok")).toBeVisible();
		await expect(four.locator('[data-arm-id="none-messy"]')).toBeHidden();
		await four.locator("label.compare-tab", { hasText: "no skill messy" }).click();
		await expect(four.locator('[data-arm-id="none-messy"]')).toBeVisible();
		await expect(four.locator('[data-arm-id="none-messy"] details.trace-details')).toHaveAttribute(
			"open",
			"",
		);
		await expect(four.getByText("none-messy-ok")).toBeVisible();
		await expect(four.locator('[data-arm-id="skel-clean"]')).toBeHidden();
		await expect(
			four.getByText("Lower is better: green is lowest and red is highest."),
		).toBeVisible();
		await expect(
			four.locator(".compare-table tr", { hasText: "Tokens" }).locator("td.is-better"),
		).toHaveCount(1);
		await expect(four.getByText("skel-clean must beat none-clean on tokens")).toBeVisible();
		await expect(four.getByText("Δ is B minus A")).toHaveCount(0);
	});

	test("stacks compare arms on a phone-width viewport", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		report = await openReport(page);
		const pair = scenarioDetails(page, "pair");
		await focusReportScenario(page, "pair");
		await expect(pair.locator('[data-arm-id="a"]')).toBeVisible();
		await expect(pair.locator('[data-arm-id="b"]')).toBeHidden();
		const tracks = await pair.locator(".compare-arms").evaluate((node) => {
			return getComputedStyle(node).gridTemplateColumns;
		});
		expect(tracks.split(/\s+/).filter(Boolean)).toHaveLength(1);
		await expect(page.getByRole("heading", { name: "Run report" })).toBeVisible();
		await expect(scenarioDetails(page, "broken")).toHaveAttribute("open", "");
	});

	test("serves the file at / and 404s other paths", async ({ page }) => {
		report = await openReport(page, e2eReports());
		const index = await page.goto(new URL("index.html", report.url).href);
		expect(index?.status()).toBe(200);
		await expect(page.getByRole("heading", { name: "Run report" })).toBeVisible();
		const missing = await page.goto(new URL("other", report.url).href);
		expect(missing?.status()).toBe(404);
	});
});
