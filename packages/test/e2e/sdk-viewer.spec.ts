import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadSdkCatalog } from "../dist/sdk/viewer.js";
import {
	ExecutionStore,
	executionHistoryRoot,
	saveExecutionVerdict,
} from "../src/sdk/execution-store.js";
import type { VerdictResult } from "../src/sdk/verdict.js";
import { listenViewer } from "../src/viewer/server.js";
import { createTestCatalog } from "../src/viewer/test-catalog.js";

const CANDIDATE = /^candidate$/;
const NAMED_OPERATIONS = /named operations/;
const SETUP_VIEW = /view=setup/;
const EXECUTION_LABEL = /^Execution /;
const INDICATIVE_LABEL = /^indicative$/;
const TOKEN_METRIC = /^Tokens\d+$/;

const ELAPSED_SECONDS = /^\d+s$/;
const NOW_RUNNING_TESTS = /Now: Run command\s*bun test/;

test("TypeScript tests run from the catalog and retain named operations after reload", async ({
	page,
}) => {
	const config = fileURLToPath(new URL("../fixtures/sdk-v2/agent-test.config.ts", import.meta.url));
	const testCatalog = await loadSdkCatalog(config);
	const title = "parallel named runs and selected-input judging";
	const selected = testCatalog.tests.find((entry) => entry.title.at(-1) === title);
	if (!selected) throw new Error("Fixture test is missing from discovered catalog");
	const viewer = await listenViewer({
		testCatalog,
		suitesDir: config,
	});
	try {
		await page.goto(viewer.url);
		await checkCatalogShell(page, testCatalog.tests);
		await page
			.getByRole("navigation", { name: "Tests" })
			.getByRole("link")
			.filter({ hasText: title })
			.click();
		await expect(page.getByRole("heading", { name: title })).toBeVisible();
		await expect(page.getByText(selected.description ?? "", { exact: true })).toBeVisible();
		await checkHeaderOrganization(page, title);
		await checkTestTabs(page);
		await checkButtonChrome(page);
		await expect(page.getByLabel("Compare with")).toHaveCount(0);
		await page.getByRole("button", { name: "Run this test" }).click();
		await expect.poll(() => new URL(page.url()).searchParams.get("execution")).toBeTruthy();
		// A custom adapter cannot be calibrated and only detects escapes, so its run is indicative.
		await waitForStatus(page, INDICATIVE_LABEL, 15000);
		await checkSidebarStatus(page, title, "indicative");
		await checkMobileSidebarStatus(page, title, "indicative");
		await checkOperationLabels(page);
		await checkRunPresentation(page);
		await checkExecutionSelection(page, title);
		await page.screenshot({
			path: test.info().outputPath("agent-test-v2-viewer.png"),
			fullPage: true,
		});
	} finally {
		await viewer.close();
	}
});

test("test navigation becomes an accessible drawer on tablet and mobile", async ({ page }) => {
	const config = fileURLToPath(new URL("../fixtures/sdk-v2/agent-test.config.ts", import.meta.url));
	const testCatalog = await loadSdkCatalog(config);
	const firstTest = testCatalog.tests[0];
	if (!firstTest) throw new Error("Fixture catalog is empty");
	const firstTitle = firstTest.title.at(-1);
	if (!firstTitle) throw new Error("Fixture test title is empty");
	const viewer = await listenViewer({ testCatalog, suitesDir: config });
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(viewer.url);
		await checkClosedMobileNavigation(page);
		await checkDrawerKeyboardBehavior(page);
		await checkTabletBackdrop(page);
		await checkDrawerSelectionAndReflow(page, firstTitle);
		await checkReducedMotionDrawer(page);
		await checkDesktopNavigationRestored(page);
	} finally {
		await viewer.close();
	}
});

async function checkClosedMobileNavigation(page: Page) {
	await expect(page.getByRole("button", { name: "Open test menu" })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Tests" })).toHaveCount(0);
	await expect(page.getByRole("main")).toHaveCSS("width", "390px");
}

async function checkDrawerKeyboardBehavior(page: Page) {
	const menu = page.getByRole("button", { name: "Open test menu" });
	await menu.click();
	const dialog = page.getByRole("dialog", { name: "Tests" });
	await expect(dialog.getByRole("button", { name: "Close test menu" })).toBeFocused();
	await expect(dialog.getByRole("button", { name: "Run all tests" })).toBeVisible();
	await expect(dialog.getByRole("spinbutton", { name: "Concurrent workers" })).toHaveValue("1");
	await page.keyboard.press("Tab");
	expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(menu).toBeFocused();
}

async function checkTabletBackdrop(page: Page) {
	await page.setViewportSize({ width: 768, height: 1024 });
	const menu = page.getByRole("button", { name: "Open test menu" });
	await menu.click();
	await page.mouse.click(740, 500);
	await expect(page.getByRole("dialog", { name: "Tests" })).toBeHidden();
	await expect(menu).toBeFocused();
}

async function checkDrawerSelectionAndReflow(page: Page, title: string) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Open test menu" }).click();
	const dialog = page.getByRole("dialog", { name: "Tests" });
	await dialog
		.getByRole("navigation", { name: "Tests" })
		.getByRole("link")
		.filter({ hasText: title })
		.click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "200%";
	});
	const fitsViewport = await page.evaluate(
		() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
	);
	expect(fitsViewport).toBe(true);
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
	});
}

async function checkReducedMotionDrawer(page: Page) {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.getByRole("button", { name: "Open test menu" }).click();
	await expect(page.getByRole("dialog", { name: "Tests" })).toHaveCSS("animation-name", "none");
	await page.keyboard.press("Escape");
}

async function checkDesktopNavigationRestored(page: Page) {
	await page.setViewportSize({ width: 768, height: 1024 });
	await page.getByRole("button", { name: "Open test menu" }).click();
	await expect(page.getByRole("dialog", { name: "Tests" })).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(page.getByRole("button", { name: "Open test menu" })).toHaveCount(0);
	await expect(page.getByRole("navigation", { name: "Tests" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Collapse test sidebar" })).toBeVisible();
}

async function checkCatalogShell(page: Page, tests: Array<{ title: string[]; file: string }>) {
	await checkSkipLink(page);
	await checkCatalogEndpoint(page);
	await checkSuiteRunButtons(page, tests);
	await checkWorkerControlAndHeaderSpacing(page);
	await expect(page.getByRole("navigation", { name: "Tests" }).getByRole("link")).toHaveCount(
		tests.length,
	);
	await checkSidebarSections(page, tests);
	await checkSidebarToggle(page);
}

async function checkWorkerControlAndHeaderSpacing(page: Page) {
	const workers = page.getByRole("spinbutton", { name: "Concurrent workers" });
	await expect(workers).toHaveValue("1");
	await workers.fill("3");
	await expect(workers).toHaveValue("3");
	await expect(page.getByRole("link", { name: "agent-test" })).toHaveCount(0);
	const title = page.getByRole("heading", { name: "Tests" });
	const runButton = page.getByRole("button", { name: "Run all tests" });
	const [titleBox, runBox, workersBox] = await Promise.all(
		[title, runButton, workers].map((element) =>
			element.evaluate((node) => node.getBoundingClientRect().toJSON()),
		),
	);
	expect(titleBox.bottom).toBeLessThan(runBox.y);
	expect(
		Math.abs(runBox.y + runBox.height / 2 - (workersBox.y + workersBox.height / 2)),
	).toBeLessThan(1);
}

async function checkSuiteRunButtons(page: Page, tests: Array<{ title: string[]; file: string }>) {
	await expect(page.getByRole("button", { name: "Run all tests" })).toBeVisible();
	const suites = new Set(tests.map((test) => test.title.slice(0, -1).join(" › ") || test.file));
	for (const suite of suites) {
		await expect(page.getByRole("button", { name: `Run ${suite} suite` })).toBeVisible();
	}
}

async function checkCatalogEndpoint(page: Page) {
	const catalogStatus = await page.evaluate(async () => (await fetch("/api/test-catalog")).status);
	expect(catalogStatus).toBe(200);
}

async function checkSkipLink(page: Page) {
	const skip = page.getByRole("link", { name: "Skip to content" });
	await skip.focus();
	await expect(skip).toBeVisible();
	await skip.press("Enter");
	await expect(page.getByRole("main")).toBeFocused();
}

test("failed assertion details belong to the test verdict", async ({ page, context }) => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-failure-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000001";
	const testId = "viewer-failure";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "failure.spec.ts"),
			title: "viewer › failing assertion",
			project: "default",
			criteria: ["The seeded file exists before the run.", "The response is exactly SEED-READY."],
		},
	]);
	await seedFailedExecution(config, testId, executionId);
	const viewer = await listenViewer({ suitesDir: config, testCatalog: catalog });
	try {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: viewer.url,
		});
		await page.goto(new URL(`/tests/${testId}?execution=${executionId}`, viewer.url).toString());
		await expect(page.getByRole("heading", { name: "failing assertion" })).toBeVisible();
		await expect(page.getByText("Test attempt", { exact: true })).toHaveCount(0);
		const result = page.getByRole("region", { name: "Test verdict" });
		await checkFailedVerdict(page, result);
		await checkCriterionResults(result);
		await expect(
			result.getByText("The test did not satisfy all assertions. See the failure details below."),
		).toHaveCount(0);
		await expect(result.getByText("Assertion failed", { exact: true })).toHaveCount(0);
		const comparison = await checkFailurePlacement(result);
		await expect(comparison.locator("dl")).toBeVisible();
		await expect(comparison.locator("dt")).toHaveCount(2);
		await expect(comparison.locator("dd").first()).toHaveText("SEED-READY");
		await expect(comparison.locator("dd").last()).toHaveText("I’ll read `seeded.txt`.\nSEED-READY");
		await expect(result.getByLabel("Expected value")).toHaveCount(0);
		await expect(result.getByLabel("Received value")).toHaveCount(0);
		await expect(result.getByText("- Expected  - 0", { exact: true })).toHaveCount(0);
		await expect(result.getByText("+ Received  + 1", { exact: true })).toHaveCount(0);
		await checkFailureClipboard(page);
	} finally {
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

async function checkFailurePlacement(result: Locator) {
	const comparison = result.getByRole("region", { name: "Expected vs received" });
	const failedCriterion = result
		.getByRole("region", { name: "Criterion results" })
		.getByRole("listitem")
		.filter({ hasText: "The response is exactly SEED-READY." });
	await expect(failedCriterion.getByRole("region", { name: "Expected vs received" })).toBeVisible();
	await expect(result.locator(':scope > [aria-label="Expected vs received"]')).toHaveCount(0);
	return comparison;
}

test("agent and judge operations have separate conversation sections", async ({ page }) => {
	const fixture = await conversationSwitcherFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const agents = page.getByRole("region", { name: "Agents" });
		const judges = page.getByRole("region", { name: "Judges" });
		const agentParticipants = agents.getByRole("tablist", { name: "Agents participants" });
		const judgeParticipants = judges.getByRole("tablist", { name: "Judges participants" });
		await checkResultPlacement(agents, "Agents");
		await expect(judges.getByRole("region", { name: "Result", exact: true })).toHaveCount(0);
		const agent = agentParticipants.getByRole("tab", { name: "agent", exact: true });
		const judge = judgeParticipants.getByRole("tab", { name: "releaseAdvice", exact: true });
		const runs = agents.getByRole("tablist", { name: "agent runs" });
		await checkAgentControlsPlacement(agents);
		const runOne = runs.getByRole("tab", { name: "Run 1" });
		const runTwo = runs.getByRole("tab", { name: "Run 2" });
		await expect(agentParticipants.getByRole("tab")).toHaveCount(1);
		await expect(judgeParticipants.getByRole("tab")).toHaveCount(1);
		await expect(page.getByText("agent ×2", { exact: true })).toHaveCount(1);
		await expect(page.getByText("completed", { exact: true })).toHaveCount(0);
		await checkParticipantTabCss(agent, agentParticipants);
		await expect(agent.getByRole("status", { name: "agent is done" })).toBeVisible();
		await expect(agent).toHaveAttribute("aria-selected", "true");
		await expect(judge).toHaveAttribute("aria-selected", "true");
		await expect(resultTokenCount(agents)).toHaveText("101");
		await checkInitialRunSelection(runOne, runTwo);
		await checkVerdictCriteria(page, agents);
		await runTwo.click();
		await expect(runTwo).toHaveAttribute("aria-selected", "true");
		await expect(resultTokenCount(agents)).toHaveText("202");
		await checkMarkdownFormatting(agents.getByRole("region", { name: "Agents messages" }));
		await expect(agents.getByText("The answer identifies the production risk.")).toBeHidden();
		await checkJudgeReview(judges);
		await checkNarrowSections(page, [agents], judges);
		await expect(judges.getByRole("region", { name: "Context included" })).toBeVisible();
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

async function checkAgentControlsPlacement(agents: Locator) {
	const surface = agents.getByRole("region", { name: "Result", exact: true }).locator("..");
	await expect(surface.getByRole("heading", { name: "Agents" })).toBeVisible();
	const participants = surface.getByRole("tablist", { name: "Agents participants" });
	const runs = surface.getByRole("tablist", { name: "agent runs" });
	const result = surface.getByRole("region", { name: "Result", exact: true });
	const [participantBox, runBox, resultBox] = await Promise.all([
		participants.boundingBox(),
		runs.boundingBox(),
		result.boundingBox(),
	]);
	expect((participantBox?.y ?? 0) + (participantBox?.height ?? 0)).toBeLessThanOrEqual(
		runBox?.y ?? 0,
	);
	expect((runBox?.y ?? 0) + (runBox?.height ?? 0)).toBeLessThanOrEqual(resultBox?.y ?? 0);
}

function resultTokenCount(conversation: Locator) {
	return conversation
		.getByRole("region", { name: "Result", exact: true })
		.locator("div")
		.filter({ hasText: TOKEN_METRIC })
		.locator("span")
		.last();
}

/** Every check is listed once, in the test verdict; agent results hold only metrics. */
async function checkVerdictCriteria(page: Page, agents: Locator) {
	const verdict = page.getByRole("region", { name: "Test verdict" });
	const criteria = verdict.getByRole("region", { name: "Criterion results" }).getByRole("listitem");
	await expect(criteria.filter({ hasText: "The first agent response is useful." })).toHaveCount(1);
	await expect(criteria.filter({ hasText: "The second agent response is useful." })).toHaveCount(1);
	await expect(agents.getByRole("region", { name: "Criterion results" })).toHaveCount(0);
}

async function checkInitialRunSelection(runOne: Locator, runTwo: Locator) {
	await expect(runOne).toHaveAttribute("aria-selected", "true");
	await expect(runTwo).toHaveAttribute("aria-selected", "false");
}

async function checkResultPlacement(conversation: Locator, label: string) {
	const result = conversation.getByRole("region", { name: "Result", exact: true });
	await expect(result).toBeVisible();
	await expect(conversation.getByRole("heading", { name: label })).toBeVisible();
	await expect(result.locator("xpath=following-sibling::*[1]")).toHaveAttribute(
		"aria-label",
		`${label} messages`,
	);
}

async function checkNarrowResultPlacement(page: Page, conversation: Locator) {
	await page.setViewportSize({ width: 560, height: 800 });
	const placement = await conversation
		.getByRole("region", { name: "Result", exact: true })
		.evaluate((result) => {
			const parent = result.parentElement?.getBoundingClientRect();
			const resultBox = result.getBoundingClientRect();
			const messages = result.nextElementSibling?.getBoundingClientRect();
			return {
				inside: Boolean(parent && resultBox.left >= parent.left && resultBox.right <= parent.right),
				beforeMessages: Boolean(messages && resultBox.bottom <= messages.top),
			};
		});
	expect(placement).toEqual({ inside: true, beforeMessages: true });
}

async function checkNarrowSections(page: Page, sections: Locator[], judges?: Locator) {
	for (const section of sections) await checkNarrowResultPlacement(page, section);
	if (judges) await checkNarrowJudgeContext(judges);
}

async function checkNarrowJudgeContext(judges: Locator) {
	const context = judges.getByRole("region", { name: "Context included" });
	const fits = await context.evaluate((element) => element.scrollWidth <= element.clientWidth);
	expect(fits).toBe(true);
	await expect(context.getByRole("tab", { name: "agent · Run 1" })).toBeVisible();
	await expect(context.getByRole("region", { name: "Additional context" })).toBeVisible();
}

async function checkMarkdownFormatting(conversation: Locator) {
	await expect(conversation.locator("strong")).toHaveText("the release");
	await expect(conversation.getByRole("listitem")).toHaveText([
		"Define rollback",
		"Assign an owner",
	]);
	await expect(conversation.locator("pre code")).toHaveText(
		'return task.completedAt ? "open" : "done";',
	);
	const [blockCodeSize, messageSize] = await Promise.all([
		conversation
			.locator("pre code")
			.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
		conversation
			.locator(".message-markdown")
			.first()
			.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
	]);
	expect(blockCodeSize).toBeLessThan(messageSize);
	await expect(conversation.locator("code").filter({ hasText: "src/status.ts:7" })).toBeVisible();
	await expect(conversation.getByText("**the release**", { exact: true })).toHaveCount(0);
	await expect(conversation.getByText("[src/status.ts:7]", { exact: false })).toHaveCount(0);
}

async function checkParticipantTabCss(participant: Locator, tablist: Locator) {
	await expect(participant).toHaveCSS("border-radius", "0px");
	await expect(participant).toHaveCSS("border-bottom-width", "2px");
	await expect(tablist).toHaveCSS("border-bottom-width", "1px");
	const height = await participant.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).height),
	);
	expect(height).toBeGreaterThanOrEqual(24);
}

async function checkJudgeReview(conversation: Locator) {
	await expect(conversation.getByRole("heading", { name: "Judges" })).toBeVisible();
	const findings = conversation.getByRole("region", { name: "Judge response" });
	await expect(findings).toContainText("Agent response");
	await expect(findings).toContainText("Second agent response");
	await expect(findings).toContainText("From agent · Run 1");
	await expect(findings).toContainText("From agent · Run 2");
	await expect(findings.getByLabel("Passed")).toHaveCount(2);
	await expect(findings).not.toContainText("judged");
	await expect(findings).toContainText("Compared with");
	await expect(findings).toContainText("Release State: No rollback plan is available.");
	await expect(findings).toContainText("It names the production rollback risk.");
	await expect(findings).toContainText("It recommends waiting for a rollback plan.");
	await expect(
		conversation.getByText("Identify the release risk and a practical next step.", { exact: true }),
	).toBeVisible();
	const context = conversation.getByRole("region", { name: "Context included" });
	await expect(context).toContainText("What the judge saw · 3 selected fields");
	await expect(context.getByRole("tablist", { name: "Agent answers included" })).toBeHidden();
	await context.getByText("What the judge saw").click();
	const answers = context.getByRole("tablist", { name: "Agent answers included" });
	const runOne = answers.getByRole("tab", { name: "agent · Run 1" });
	const runTwo = answers.getByRole("tab", { name: "agent · Run 2" });
	await expect(runOne).toHaveAttribute("aria-selected", "true");
	await expect(runTwo).toHaveAttribute("aria-selected", "false");
	await expect(runOne).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	const firstAnswer = context.getByRole("tabpanel", { name: "Agent response from agent · Run 1" });
	await expect(firstAnswer.getByText("Agent Response", { exact: true })).toHaveCount(0);
	await expect(firstAnswer.locator("strong")).toHaveText("the release");
	await runOne.focus();
	await runOne.press("ArrowRight");
	await expect(runTwo).toBeFocused();
	await expect(
		context.getByRole("tabpanel", { name: "Agent response from agent · Run 2" }),
	).toContainText("Hold the release until rollback is ready.");
	const additional = context.getByRole("region", { name: "Additional context" });
	await expect(additional).toContainText("Release State");
	await expect(additional).toContainText("No rollback plan is available.");
	await expect(additional).not.toContainText("Agent Response");
}

async function checkFailureClipboard(page: Page) {
	const copy = page.getByRole("button", { name: "Copy failure details" });
	await copy.click();
	await expect(copy).toHaveText("Copied");
	const details = await page.evaluate(() => navigator.clipboard.readText());
	expect(details).toContain("Fix this agent test failure.");
	expect(details).toContain("Test: failing assertion");
	expect(details).toContain("Status: failed");
	expect(details).toContain("[not-recorded] The seeded file exists before the run.");
	expect(details).toContain("[failed] The response is exactly SEED-READY.");
	expect(details).toContain("Expected  - 0");
}

async function checkFailedVerdict(page: Page, verdict: Locator) {
	await expect(verdict).toContainText("Failed · 1 of 2 checks failed");
	const agentResult = page.getByRole("region", { name: "Result", exact: true });
	await expect(agentResult.getByRole("region", { name: "Criterion results" })).toHaveCount(0);
}

async function checkCriterionResults(result: ReturnType<Page["getByRole"]>) {
	const criteria = result.getByRole("region", { name: "Criterion results" });
	const seeded = criteria
		.getByRole("listitem")
		.filter({ hasText: "The seeded file exists before the run." });
	const response = criteria
		.getByRole("listitem")
		.filter({ hasText: "The response is exactly SEED-READY." });
	await expect(result.getByText("Criteria results", { exact: true })).toHaveCount(0);
	await expect(result.getByText("Passed — no assertions failed.", { exact: true })).toHaveCount(0);
	await expect(seeded.getByLabel("Not recorded")).toHaveText("–");
	await expect(response.getByLabel("Failed")).toHaveText("×");
}

test("running conversation updates through WebSocket without detail polling", async ({ page }) => {
	const fixture = await runningExecutionFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	const detailRequests = await trackDetailRequests(page, fixture.executionId);
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const conversation = page.getByRole("region", { name: "Agents" });
		const running = conversation.getByRole("status", { name: "Agent is running" });
		await expect(running).toContainText("Running");
		const live = await checkLiveStripBeforeEvents(page);
		const requestsAfterInitialRender = detailRequests();
		await recordLiveConversation(fixture);
		const completed = page
			.getByRole("tablist", { name: "Agents participants" })
			.getByRole("tab", { name: "finished", exact: true });
		const participant = page
			.getByRole("tablist", { name: "Agents participants" })
			.getByRole("tab", { name: "seeded", exact: true });
		await expect(completed).toHaveAttribute("aria-selected", "true");
		await expect(completed.getByRole("status", { name: "finished is done" })).toBeVisible();
		await expect(running).toHaveCount(0);
		await expect(participant).toBeVisible();
		await expect(participant.getByRole("status", { name: "seeded is running" })).toBeVisible();
		await participant.click();
		await expect(running).toBeVisible();
		await expect(conversation.getByText("Inspect the seeded file.", { exact: true })).toBeVisible();
		await expect(conversation.getByText("Read file", { exact: true })).toBeVisible();
		await expect(conversation.getByText("I found the seed.", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("tabpanel", { name: "Current run" }).getByText("running", { exact: true }),
		).toBeVisible();
		await checkLiveStripFollowsSteps(live, fixture);
		expect(detailRequests()).toBe(requestsAfterInitialRender);
		await finishRunningExecution(fixture);
		await expect(running).toHaveCount(0);
		await expect(live).toHaveCount(0);
		await expect(participant.getByRole("status", { name: "seeded is running" })).toHaveCount(0);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

async function checkLiveStripBeforeEvents(page: Page) {
	const live = page.getByRole("region", { name: "Live run status" });
	await expect(live).toContainText("0 steps");
	await expect(live).toContainText("Now: Preparing the next step");
	await expect(live.locator("time")).toHaveText(ELAPSED_SECONDS);
	return live;
}

async function checkLiveStripFollowsSteps(
	live: Locator,
	fixture: Awaited<ReturnType<typeof runningExecutionFixture>>,
) {
	await expect(live).toContainText("1 step");
	await expect(live).toContainText("Now: Writing a reply");
	await fixture.store.record({
		type: "operation.agent",
		level: "debug",
		attemptId: "attempt-1",
		operationId: "agent-1",
		data: { type: "tool", name: "bash", args: { command: "bun test" } },
	});
	await expect(live).toContainText("2 steps");
	await expect(live).toContainText(NOW_RUNNING_TESTS);
}

async function trackDetailRequests(page: Page, executionId: string) {
	let count = 0;
	await page.route(`**/api/executions/${executionId}`, async (route) => {
		count++;
		if (count === 1) await route.continue();
		else await route.abort();
	});
	return () => count;
}

test("a judge appears while running and completes in place", async ({ page }) => {
	const fixture = await runningJudgeFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const conversation = page.getByRole("region", { name: "Judges" });
		const participant = page
			.getByRole("tablist", { name: "Judges participants" })
			.getByRole("tab", { name: "releaseAdvice", exact: true });
		await expect(participant).toHaveAttribute("aria-selected", "true");
		await expect(
			participant.getByRole("status", { name: "releaseAdvice is running" }),
		).toBeVisible();
		await expect(conversation.getByRole("status", { name: "Judge is running" })).toBeVisible();
		await expect(
			conversation.getByText("Should this release proceed?", { exact: true }),
		).toBeVisible();
		const context = conversation.getByRole("region", { name: "Context included" });
		await expect(context.getByText("Rollback Ready", { exact: true })).toBeHidden();
		await context.getByText("What the judge saw").click();
		await expect(context.getByText("Rollback Ready", { exact: true })).toBeVisible();
		await expect(context.getByText("true", { exact: true })).toBeVisible();
		await expect(conversation.getByRole("region", { name: "Judge response" })).toHaveCount(0);

		await finishRunningJudge(fixture);
		await expect(conversation.getByRole("status", { name: "Judge is running" })).toHaveCount(0);
		await expect(participant.getByRole("status", { name: "releaseAdvice is done" })).toBeVisible();
		await expect(conversation.getByRole("region", { name: "Judge response" })).toContainText(
			"The rollback plan is ready.",
		);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

test("a terminal-started execution opens and streams in an already-open viewer", async ({
	page,
}) => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-terminal-run-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000006";
	const testId = "viewer-terminal-run";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "terminal.spec.ts"),
			title: "viewer › terminal run",
			project: "default",
		},
	]);
	const viewer = await listenViewer({
		suitesDir: config,
		testCatalog: catalog,
		watchWorkspace: false,
		executionPollMs: 20,
	});
	try {
		await page.goto(new URL(`/tests/${testId}?view=setup`, viewer.url).toString());
		await expect(page.getByRole("tabpanel", { name: "Test setup" })).toBeVisible();
		const store = await ExecutionStore.create({
			root: join(executionHistoryRoot(config), executionId),
			id: executionId,
			config,
			ownerPid: process.pid,
		});
		await store.setTests([testId]);
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "terminal-attempt",
			data: { testId, title: ["viewer", "terminal run"], project: "default", retry: 0 },
		});
		await expect(page).toHaveURL(new RegExp(`/tests/${testId}\\?execution=${executionId}$`));
		await expect(page.getByRole("button", { name: "Stop this run" })).toHaveCount(0);
		await expect(page.getByRole("region", { name: "Live run status" })).toBeVisible();
	} finally {
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("Run all can be stopped before the first attempt starts", async ({ page }) => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-stop-"));
	const config = join(directory, "agent-test.config.ts");
	const catalog = createTestCatalog(config, [
		{
			id: "first",
			file: join(directory, "suite.spec.ts"),
			title: "suite › first",
			project: "default",
		},
		{
			id: "second",
			file: join(directory, "suite.spec.ts"),
			title: "suite › second",
			project: "default",
		},
	]);
	const executionId = "feed0000-0000-4000-8000-000000000003";
	const root = join(executionHistoryRoot(config), executionId);
	const store = await ExecutionStore.create({ root, id: executionId, config });
	let finish = (_code: number) => undefined;
	const completed = new Promise<number>((resolveCompleted) => {
		finish = resolveCompleted;
	});
	const viewer = await listenViewer({
		suitesDir: config,
		testCatalog: catalog,
		startExecution: async () => {
			await store.setTests(["first", "second"]);
			return {
				id: executionId,
				completed,
				cancel: () => {
					setTimeout(() => void store.finish("interrupted").then(() => finish(130)), 200);
				},
			};
		},
	});
	try {
		await page.goto(viewer.url);
		await page.getByRole("button", { name: "Run all tests" }).click();
		await expect(page.getByText("Starting 2 tests…", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Stop suite run" }).click();
		await expect(page.getByRole("button", { name: "Stopping…" })).toBeDisabled();
		await expect(page.getByText("Run stopped before the first test started.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Stop suite run" })).toHaveCount(0);
	} finally {
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("a running suite shows each test's actual status and name", async ({ page }) => {
	const fixture = await mixedStatusExecutionFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(new URL(`/executions/${fixture.executionId}`, viewer.url).toString());
		const navigation = page.getByRole("navigation", { name: "Tests" });
		await expectTestStatus(navigation, "Passed test", "passed");
		await expectTestStatus(navigation, "Failed test", "failed");
		await expectTestStatus(navigation, "Active test", "running");
		await expectTestStatus(navigation, "Queued test", "queued");
		const main = page.getByRole("main");
		await expect(main.getByText("Passed test", { exact: true })).toBeVisible();
		await expect(main.getByText("Failed test", { exact: true })).toBeVisible();
		await expect(main.getByText("Active test", { exact: true })).toBeVisible();
		await expect(page.getByText("Test attempt", { exact: true })).toHaveCount(0);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

const BACK_TO_RUN = /Back to run/;

test("the run inbox lists failures first and history reads each test's own status", async ({
	page,
}) => {
	const fixture = await inboxExecutionFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(viewer.url);
		const main = page.getByRole("main");
		await expect(main.getByText("Latest run", { exact: true })).toBeVisible();
		const rows = main.getByRole("list").first().getByRole("link");
		await expect(rows).toHaveCount(3);
		await expect(rows.first()).toContainText("Broken test");
		await expect(rows.last()).toContainText("Skipped test");
		await main.getByRole("button", { name: "Passed 1" }).click();
		await expect(rows).toHaveCount(1);
		await rows.first().click();
		await expect(page.getByRole("link", { name: BACK_TO_RUN })).toBeVisible();
		await page.getByRole("tab", { name: "Run history" }).click();
		await expect(
			page.getByRole("button", {
				name: `Open passed execution ${fixture.executionId.slice(0, 8)}`,
			}),
		).toBeVisible();
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

async function inboxExecutionFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-inbox-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000007";
	const tests = ["Passing test", "Broken test", "Skipped test"].map((title) => ({
		id: title.toLowerCase().replace(" ", "-"),
		file: join(directory, "suite.spec.ts"),
		title: `suite › ${title}`,
		project: "default",
	}));
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests(tests.map((entry) => entry.id));
	await seedStatusAttempt(store, {
		testId: "passing-test",
		title: "Passing test",
		status: "passed",
	});
	await seedStatusAttempt(store, { testId: "broken-test", title: "Broken test", status: "failed" });
	await seedSkippedAttempt(store, "skipped-test");
	await store.finish("failed");
	return { directory, config, executionId, catalog: createTestCatalog(config, tests) };
}

async function seedSkippedAttempt(store: ExecutionStore, testId: string) {
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: testId,
		data: { testId, title: ["suite", "Skipped test"], project: "default", retry: 0 },
	});
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: testId,
		data: { status: "skipped", durationMs: 0, errors: [] },
	});
}

const ENLARGE_READ_IMAGE = /^Enlarge image from Read file/;
const SHRINK_IMAGE = /^Shrink/;
const ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("tool images render as thumbnails, enlarge in place, and oversized images show a placeholder", async ({
	page,
}) => {
	const fixture = await runningExecutionFixture();
	await fixture.store.record({
		type: "operation.complete",
		level: "debug",
		attemptId: "attempt-1",
		operationId: "agent-images",
		data: {
			name: "screenshotter",
			prompt: "Read the logo.",
			output: "It is a single pixel.",
			trace: {
				messages: [{ role: "assistant", content: "It is a single pixel.", seq: 1 }],
				toolCalls: [
					{
						name: "Read",
						args: { file_path: "logo.png" },
						result: '["[image: image/png, 1 KB]","[image omitted: image/png, 900 KB]"]',
						images: [
							{ mediaType: "image/png", bytes: 70, data: ONE_PIXEL_PNG },
							{ mediaType: "image/png", bytes: 921_600 },
						],
						seq: 0,
					},
				],
			},
		},
	});
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const images = page.getByRole("list", { name: "Images returned by Read file" });
		const thumbnail = images.getByRole("img");
		await expect(thumbnail).toBeVisible();
		await expect
			.poll(() => thumbnail.evaluate((node: HTMLImageElement) => node.naturalWidth))
			.toBe(1);
		const enlarge = images.getByRole("button", { name: ENLARGE_READ_IMAGE });
		await enlarge.click();
		await expect(images.getByRole("button", { name: SHRINK_IMAGE })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(images.getByText("image/png · 900 KB · too large to store")).toBeVisible();
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

const JUDGE_CHECKS = [
	"The judge finds the release risk.",
	"The judge finds a practical next step.",
];

test("the test verdict lists every check, including judge-decided checks", async ({ page }) => {
	const fixture = await judgeVerdictFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const verdict = page.getByRole("region", { name: "Test verdict" });
		await expect(verdict).toContainText("Passed · 2 of 2 checks passed");
		for (const check of JUDGE_CHECKS) await expect(verdict.getByText(check)).toBeVisible();
		await checkSharedJudgeReason(page, verdict);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

const SHARED_REASON = "Both findings rest on the same rollback discussion.";

/** A reason covering every field shows once, after the findings, and never as a per-check note. */
async function checkSharedJudgeReason(page: Page, verdict: Locator) {
	await expect(verdict.getByText(SHARED_REASON)).toHaveCount(0);
	const findings = page.getByRole("region", { name: "Judge response" });
	await expect(findings.getByText(SHARED_REASON, { exact: true })).toHaveCount(1);
	await expect(findings.getByText("Reason", { exact: true })).toBeVisible();
	const judges = await page.getByRole("region", { name: "Judges", exact: true }).boundingBox();
	const agents = await page.getByRole("region", { name: "Agents", exact: true }).boundingBox();
	expect(judges?.y ?? 0).toBeLessThan(agents?.y ?? 0);
}

async function judgeVerdictFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-verdict-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000008";
	const testId = "viewer-judge-verdict";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "judge.spec.ts"),
			title: "viewer › judged advice",
			project: "default",
			criteria: JUDGE_CHECKS,
		},
	]);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests([testId]);
	await recordJudgedAttempt(store, testId);
	await store.finish("passed");
	return { directory, config, executionId, testId, catalog };
}

async function recordJudgedAttempt(store: ExecutionStore, testId: string) {
	const shared = { level: "debug" as const, attemptId: "attempt-1" };
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: "attempt-1",
		data: { testId, title: ["viewer", "judged advice"], project: "default", retry: 0 },
	});
	await recordAgentOperation({
		store,
		shared,
		operationId: "agent-1",
		output: "Hold the release.",
	});
	await store.record({
		...shared,
		type: "operation.evaluation",
		operationId: "judge-1",
		data: {
			name: "releaseAdvice",
			invocationIndex: 1,
			criterionIndexes: [0, 1],
			evaluation: { prompt: "Does the answer explain the risk and a next step?" },
			input: { answer: "Hold the release." },
			output: { explainsRisk: true, suggestsNextStep: true, reason: SHARED_REASON },
		},
	});
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: "attempt-1",
		data: {
			status: "passed",
			durationMs: 12,
			criterionResults: JUDGE_CHECKS.map((criterion) => ({ criterion, status: "passed" })),
			errors: [],
		},
	});
}

async function expectTestStatus(navigation: Locator, name: string, status: string) {
	const link = navigation.getByRole("link").filter({ hasText: name });
	await expect(link.getByRole("img", { name: `Latest execution: ${status}` })).toBeVisible();
}

async function mixedStatusExecutionFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-statuses-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000004";
	const tests = ["Passed test", "Failed test", "Active test", "Queued test"].map((title) => ({
		id: title.toLowerCase().replace(" ", "-"),
		file: join(directory, "suite.spec.ts"),
		title: `suite › ${title}`,
		project: "default",
	}));
	const catalog = createTestCatalog(config, tests);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests(tests.map((entry) => entry.id));
	await seedStatusAttempt(store, { testId: "passed-test", title: "Passed test", status: "passed" });
	await seedStatusAttempt(store, { testId: "failed-test", title: "Failed test", status: "failed" });
	await seedStatusAttempt(store, { testId: "active-test", title: "Active test" });
	return { directory, config, executionId, catalog };
}

async function seedStatusAttempt(
	store: ExecutionStore,
	input: { testId: string; title: string; status?: "passed" | "failed" },
) {
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: input.testId,
		data: { testId: input.testId, title: ["suite", input.title], project: "default", retry: 0 },
	});
	if (!input.status) return;
	await store.record({
		type: "attempt.finished",
		level: input.status === "failed" ? "error" : "info",
		attemptId: input.testId,
		data: { status: input.status, durationMs: 12, errors: [] },
	});
}

async function seedFailedExecution(config: string, testId: string, executionId: string) {
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests([testId]);
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: "attempt-1",
		data: { testId, title: ["viewer", "failing assertion"], project: "default", retry: 0 },
	});
	await store.record({
		type: "attempt.finished",
		level: "error",
		attemptId: "attempt-1",
		data: {
			status: "failed",
			durationMs: 12,
			criterionResults: [
				{ criterion: "The seeded file exists before the run.", status: "not-recorded" },
				{ criterion: "The response is exactly SEED-READY.", status: "not-recorded" },
			],
			errors: [
				{
					message:
						"Error: expect(received).toBe(expected) // Object.is equality\n\n- Expected  - 0\n+ Received  + 1\n\n+ I’ll read `seeded.txt`.\n  SEED-READY",
				},
			],
		},
	});
	await store.finish("failed");
}

async function conversationSwitcherFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-conversations-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000005";
	const testId = "viewer-agent-and-judge";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "judge.spec.ts"),
			title: "viewer › agent and judge",
			project: "default",
			criteria: ["The first agent response is useful.", "The second agent response is useful."],
		},
	]);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests([testId]);
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: "attempt-1",
		data: { testId, title: ["viewer", "agent and judge"], project: "default", retry: 0 },
	});
	await seedAgentAndJudgeOperations(store);
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: "attempt-1",
		data: { status: "passed", durationMs: 20, errors: [] },
	});
	await store.finish("passed");
	return { directory, config, executionId, testId, catalog };
}

async function seedAgentAndJudgeOperations(store: ExecutionStore) {
	const formattedAgentResponse =
		'Hold **the release** until rollback is ready.\n\n- Define rollback\n- Assign an owner\n\n```ts\nreturn task.completedAt ? "open" : "done";\n```\n\nSee [src/status.ts:7](<local-path>/status.ts:7).';
	const shared = { level: "debug" as const, attemptId: "attempt-1" };
	await recordAgentOperation({
		store,
		shared,
		operationId: "agent-2",
		output: formattedAgentResponse,
	});
	await store.record({
		...shared,
		type: "operation.evaluation",
		operationId: "judge-1",
		data: {
			name: "releaseAdvice",
			invocationIndex: 1,
			criterionIndexes: [0, 1],
			evaluation: { prompt: "Identify the release risk and a practical next step." },
			input: {
				agentResponse: formattedAgentResponse,
				secondAgentResponse: formattedAgentResponse,
				releaseState: "No rollback plan is available.",
			},
			usage: { tokens: { total: 303 } },
			output: {
				agentResponseCorrect: true,
				secondAgentResponseCorrect: true,
				explanations: {
					agentResponseCorrect: "It names the production rollback risk.",
					secondAgentResponseCorrect: "It recommends waiting for a rollback plan.",
				},
				reason: "The answer identifies the production risk.",
			},
		},
	});
	await recordAgentOperation({
		store,
		shared,
		operationId: "agent-1",
		output: formattedAgentResponse,
	});
}

async function recordAgentOperation(input: {
	store: ExecutionStore;
	shared: { level: "debug"; attemptId: string };
	operationId: string;
	output: string;
}) {
	const { store, shared, operationId, output } = input;
	await store.record({
		...shared,
		type: "operation.complete",
		operationId,
		data: {
			name: "agent",
			invocationIndex: operationId === "agent-1" ? 0 : 2,
			criterionIndex: operationId === "agent-1" ? 0 : 1,
			prompt: "Should we release without a rollback plan?",
			output,
			usage: { tokens: { total: operationId === "agent-1" ? 101 : 202 } },
			trace: {
				messages: [{ role: "assistant", content: output, seq: 0 }],
				toolCalls: [],
			},
		},
	});
}

async function runningExecutionFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-live-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000002";
	const testId = "viewer-live";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "live.spec.ts"),
			title: "viewer › live conversation",
			project: "default",
		},
	]);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await store.setTests([testId]);
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId: "attempt-1",
		data: { testId, title: ["viewer", "live conversation"], project: "default", retry: 0 },
	});
	return { directory, config, executionId, testId, catalog, store };
}

async function recordLiveConversation(
	fixture: Awaited<ReturnType<typeof runningExecutionFixture>>,
) {
	await fixture.store.record({
		type: "operation.complete",
		level: "debug",
		attemptId: "attempt-1",
		operationId: "agent-completed",
		data: {
			name: "finished",
			prompt: "Finish immediately.",
			output: "Done.",
			trace: { messages: [{ role: "assistant", content: "Done.", seq: 0 }], toolCalls: [] },
		},
	});
	const shared = { level: "debug" as const, attemptId: "attempt-1", operationId: "agent-1" };
	await fixture.store.record({
		...shared,
		type: "operation.start",
		data: { name: "seeded", prompt: "Inspect the seeded file." },
	});
	await fixture.store.record({
		...shared,
		type: "operation.agent",
		data: { type: "tool", name: "Read", args: { path: "seeded.txt" } },
	});
	await fixture.store.record({
		...shared,
		type: "operation.agent",
		data: { type: "text", text: "I found the seed." },
	});
}

async function finishRunningExecution(
	fixture: Awaited<ReturnType<typeof runningExecutionFixture>>,
) {
	await fixture.store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: "attempt-1",
		data: { status: "passed", durationMs: 20, errors: [] },
	});
	await fixture.store.finish("passed");
}

async function runningJudgeFixture() {
	const fixture = await runningExecutionFixture();
	await fixture.store.record({
		type: "operation.evaluation-start",
		level: "debug",
		attemptId: "attempt-1",
		operationId: "judge-1",
		data: {
			name: "releaseAdvice",
			input: { rollbackReady: true },
			evaluation: { prompt: "Should this release proceed?" },
		},
	});
	return fixture;
}

async function finishRunningJudge(fixture: Awaited<ReturnType<typeof runningJudgeFixture>>) {
	await fixture.store.record({
		type: "operation.evaluation",
		level: "debug",
		attemptId: "attempt-1",
		operationId: "judge-1",
		data: {
			name: "releaseAdvice",
			output: { safe: true, reason: "The rollback plan is ready." },
		},
	});
	await finishRunningExecution(fixture);
}

async function waitForStatus(page: Page, label: RegExp, timeout?: number) {
	const current = page.getByRole("tabpanel", { name: "Current run" });
	await expect(current.locator("span").filter({ hasText: label })).toBeVisible({ timeout });
}

async function checkOperationLabels(page: Page) {
	await expect(page.getByText(CANDIDATE)).toHaveCount(3);
	await expect(page.getByText("completed", { exact: true })).toHaveCount(0);
	await expect(page.getByText(NAMED_OPERATIONS)).toBeVisible();
}

async function checkRunPresentation(page: Page) {
	const current = page.getByRole("tabpanel", { name: "Current run" });
	await expect(current.getByText(EXECUTION_LABEL)).toHaveCount(0);
	const agents = page.getByRole("region", { name: "Agents" });
	const judges = page.getByRole("region", { name: "Judges" });
	await expect(agents.getByRole("heading", { name: "Result" })).toBeVisible();
	await expect(judges.getByRole("heading", { name: "Result" })).toHaveCount(0);
	await expect(judges.getByRole("region", { name: "Judge response" })).toBeVisible();
	await expect(agents.getByRole("heading", { name: "Agents" })).toBeVisible();
	const conversation = agents;
	await expect(conversation.getByText("answer", { exact: true })).toHaveCount(1);
	await expect(conversation.getByText("Read file", { exact: true })).toBeVisible();
	await expect(conversation.getByText("PROJECT.md", { exact: true })).toBeVisible();
	await expect(conversation.getByText("Run command", { exact: true })).toBeVisible();
	await expect(conversation.getByText("npm test", { exact: true })).toBeVisible();
	const command = conversation.getByRole("article").filter({ hasText: "npm test" });
	const controls = command.getByRole("group", { name: "Tool controls" });
	await expect(controls.getByText("Exit 0", { exact: true })).toBeVisible();
	const outputToggle = controls.getByRole("button", { name: "View output" });
	await expect(outputToggle).toBeVisible();
	await outputToggle.click();
	await expect(command.getByRole("button", { name: "Hide output" })).toBeVisible();
	const technical = page.locator("summary").filter({ hasText: "Technical details" });
	await expect(technical).toBeVisible();
	await technical.click();
	await expect(
		page.locator("summary").filter({ hasText: "Test process logs (stdout / stderr)" }),
	).toBeVisible();
}

async function checkAgentDescription(page: Page) {
	await expect(
		page.getByText("A lower-token candidate used for the comparison.", { exact: true }),
	).toBeVisible();
}

async function checkHeaderOrganization(page: Page, title: string) {
	const activeTest = page
		.getByRole("navigation", { name: "Tests" })
		.getByRole("link")
		.filter({ hasText: title });
	await expect(activeTest).toHaveCSS("box-shadow", "none");
	const toggle = page.getByRole("button", { name: "Collapse test sidebar" });
	await expect(toggle.locator("xpath=..").getByRole("heading", { name: "Tests" })).toBeVisible();
	const heading = await page.getByRole("heading", { name: title }).boundingBox();
	const run = await page.getByRole("button", { name: "Run this test" }).boundingBox();
	expect(heading).not.toBeNull();
	expect(run).not.toBeNull();
	expect(run?.x ?? 0).toBeGreaterThan((heading?.x ?? 0) + 200);
}

async function checkTestTabs(page: Page) {
	const tabs = page.getByRole("tablist", { name: "Test views" });
	await expect(tabs.getByRole("tab")).toHaveCount(3);
	await expect(tabs.getByRole("tab", { name: "Current run" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await checkTabKeyboard(tabs);
	await expect(page.getByRole("heading", { name: "Test setup" })).toBeHidden();
	await expect(page.getByText("Current run", { exact: true })).toHaveCount(1);
	await tabs.getByRole("tab", { name: "Test setup" }).click();
	await expect(page).toHaveURL(SETUP_VIEW);
	await expect(page.getByText("Test setup", { exact: true })).toHaveCount(1);
	await checkAgentDescription(page);
	await expect(page.getByText("Check selected evidence", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Resources used by this test" })).toHaveCount(0);
	const agents = page.getByRole("region", { name: "Agents" });
	const judges = page.getByRole("region", { name: "Judges" });
	await expect(agents.getByRole("article")).toHaveCount(2);
	await expect(judges.getByRole("article")).toHaveCount(1);
	await expect(page.getByRole("region", { name: "Workspace" })).toBeVisible();
	await expect(page.getByRole("tabpanel").getByText("seeded", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Pass criteria" })).toBeVisible();
	await expect(
		page
			.getByRole("tabpanel", { name: "Test setup" })
			.getByText("The candidate uses fewer tokens than the baseline."),
	).toBeVisible();
	await tabs.getByRole("tab", { name: "Run history" }).click();
	await expect(page.getByText("Run history", { exact: true })).toHaveCount(1);
	await tabs.getByRole("tab", { name: "Current run" }).click();
	await checkNarrowTabs(page, tabs);
}

async function checkTabKeyboard(tabs: ReturnType<Page["getByRole"]>) {
	const current = tabs.getByRole("tab", { name: "Current run" });
	const setup = tabs.getByRole("tab", { name: "Test setup" });
	await current.focus();
	await current.press("ArrowRight");
	await expect(setup).toHaveAttribute("aria-selected", "true");
	await setup.press("ArrowLeft");
	await expect(current).toHaveAttribute("aria-selected", "true");
}

async function checkNarrowTabs(page: Page, tabs: ReturnType<Page["getByRole"]>) {
	await page.setViewportSize({ width: 560, height: 800 });
	await expect(tabs.getByRole("tab", { name: "Current run" })).toBeVisible();
	await expect(tabs.getByRole("tab", { name: "Run history" })).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 720 });
}

async function checkButtonChrome(page: Page) {
	const borderStyles = await page
		.locator("button")
		.evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).borderStyle));
	expect(borderStyles).not.toContain("outset");
	const current = page.getByRole("tab", { name: "Current run" });
	await expect(current).toHaveCSS("border-top-width", "0px");
	await expect(current).toHaveCSS("border-bottom-width", "2px");
}

async function checkSidebarToggle(page: Page) {
	await page.getByRole("button", { name: "Collapse test sidebar" }).click();
	await expect(page.getByRole("navigation", { name: "Tests" })).toBeHidden();
	await page.getByRole("button", { name: "Expand test sidebar" }).click();
	await expect(page.getByRole("navigation", { name: "Tests" })).toBeVisible();
}

async function checkSidebarSections(page: Page, tests: Array<{ title: string[] }>) {
	const sections = page.getByRole("navigation", { name: "Tests" }).locator("section[aria-label]");
	await expect(sections).toHaveCount(new Set(tests.map((entry) => entry.title[0])).size);
	await expect(sections.first()).toHaveCSS("border-top-style", "solid");
}

async function checkSidebarStatus(page: Page, title: string, status: string) {
	const link = page
		.getByRole("navigation", { name: "Tests" })
		.getByRole("link")
		.filter({ hasText: title });
	await expect(link.getByText(status, { exact: true })).toHaveCount(0);
	await expect(link.getByRole("img", { name: `Latest execution: ${status}` })).toBeVisible();
}

async function checkMobileSidebarStatus(page: Page, title: string, status: string) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole("button", { name: "Open test menu" }).click();
	const link = page
		.getByRole("dialog", { name: "Tests" })
		.getByRole("navigation", { name: "Tests" })
		.getByRole("link")
		.filter({ hasText: title });
	await expect(link.getByRole("img", { name: `Latest execution: ${status}` })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1280, height: 720 });
}

async function checkExecutionSelection(page: Page, title: string) {
	const firstExecution = new URL(page.url()).searchParams.get("execution");
	expect(firstExecution).toBeTruthy();
	await page.getByRole("button", { name: "Run this test" }).click();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("execution"))
		.not.toBe(firstExecution);
	await waitForStatus(page, INDICATIVE_LABEL);
	await page.getByRole("tab", { name: "Run history" }).click();
	await page
		.getByRole("button", { name: new RegExp(`execution ${firstExecution?.slice(0, 8)}`) })
		.click();
	await page.reload();
	await waitForStatus(page, INDICATIVE_LABEL);
	await expect(page.getByRole("tab", { name: "Current run" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
	await page
		.getByRole("navigation", { name: "Tests" })
		.getByRole("link")
		.filter({ hasText: "schema validation rejects malformed evaluations" })
		.click();
	await expect(page.getByRole("heading", { name: title })).not.toBeVisible();
	await page.goBack();
	await expect.poll(() => new URL(page.url()).searchParams.get("execution")).toBe(firstExecution);
}

test("a failed catalog refresh marks the test list stale and recovers by itself", async ({
	page,
}) => {
	const config = fileURLToPath(new URL("../fixtures/sdk-v2/agent-test.config.ts", import.meta.url));
	const viewer = await listenViewer({
		testCatalog: await loadSdkCatalog(config),
		suitesDir: config,
	});
	try {
		await page.clock.install();
		await page.goto(viewer.url);
		const nav = page.getByRole("navigation", { name: "Tests" });
		await expect(nav.getByRole("link").first()).toBeVisible();
		await page.route("**/api/test-catalog", (route) => route.abort());
		await page.clock.runFor(6_000);
		// Opening a test mounts a fresh catalog query, which refetches the now-stale list.
		await nav.getByRole("link").first().click();
		const stale = page.getByText("Test list may be out of date. Retrying…");
		// Each retry is scheduled only after a real network rejection, so advance in steps.
		await advanceUntil(page, () => expect(stale).toBeVisible({ timeout: 100 }));
		await expect(page.getByRole("alert")).toHaveCount(0);
		await page.unroute("**/api/test-catalog");
		await advanceUntil(page, () => expect(stale).toHaveCount(0, { timeout: 100 }));
		await expect(nav.getByRole("link").first()).toBeVisible();
	} finally {
		await viewer.close();
	}
});

test("the test header states suite intent once and folds the pass checks", async ({ page }) => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-intent-"));
	const config = join(directory, "agent-test.config.ts");
	const shared = "Review conformance against an offline mirror.";
	const entry = (id: string, title: string) => ({
		id,
		file: join(directory, "review.spec.ts"),
		title: `review › ${title}`,
		project: "default",
		description: shared,
		criteria: ["Names the failing boundary.", "Does not push."],
	});
	const catalog = createTestCatalog(config, [
		entry("intent-one", "near miss: review the branch"),
		entry("intent-two", "drive: fix CI"),
	]);
	const viewer = await listenViewer({ suitesDir: config, testCatalog: catalog });
	try {
		await page.goto(new URL("/tests/intent-one", viewer.url).toString());
		const header = page.locator("header").filter({ hasText: "near miss: review the branch" });
		await expect(header.getByText(shared, { exact: true })).toHaveCount(1);
		await expect(header.getByText("Names the failing boundary.")).toBeHidden();
		await header.getByText("Passes when · 2 checks").click();
		await expect(header.getByText("Names the failing boundary.")).toBeVisible();
	} finally {
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

async function advanceUntil(page: Page, check: () => Promise<void>) {
	await expect(async () => {
		await page.clock.runFor(1_000);
		await check();
	}).toPass({ timeout: 15_000 });
}

test("the verdict shows reported metrics and links attached files", async ({ page }) => {
	const fixture = await reportedMetricsFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const verdict = page.getByRole("region", { name: "Test verdict" });
		const metrics = verdict.getByLabel("Run metrics");
		await expect(metrics).toContainText("Dead taps2");
		await expect(metrics).toContainText("P95 latency1.5 s");
		const link = verdict.getByRole("list", { name: "Attachments" }).getByRole("link", {
			name: "steps",
		});
		const response = await page.request.get(
			new URL((await link.getAttribute("href")) ?? "", viewer.url).toString(),
		);
		expect(await response.text()).toBe('{"step":1}\n');
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

async function reportedMetricsFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-metrics-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-000000000009";
	const testId = "viewer-reported-metrics";
	const steps = join(directory, "steps.jsonl");
	await writeFile(steps, '{"step":1}\n');
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "m.spec.ts"),
			title: "viewer › metrics",
			project: "default",
		},
	]);
	const root = join(executionHistoryRoot(config), executionId);
	const store = await ExecutionStore.create({ root, id: executionId, config });
	await store.setTests([testId]);
	const attemptId = "attempt-1";
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId,
		data: { testId, title: ["viewer", "metrics"], project: "default", retry: 0 },
	});
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId,
		data: {
			status: "passed",
			attachments: [{ name: "steps", contentType: "application/x-ndjson", path: steps }],
		},
	});
	await mkdir(join(root, "progress"), { recursive: true });
	const progress = { version: 1, at: new Date().toISOString(), executionId, testId, attemptId };
	await writeFile(
		join(root, "progress", "1.json"),
		JSON.stringify({ ...progress, data: { deadTaps: 2, p95LatencyMs: 1500 } }),
	);
	await store.finish("passed");
	return { directory, config, executionId, testId, catalog };
}

test("a run states its conditions and rates, and never calls a pass reliable", async ({ page }) => {
	const fixture = await conditionsFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(viewer.url);
		const main = page.getByRole("main");
		await expect(main).toContainText(
			"Indicative: nothing failed, but the evidence cannot carry a pass",
		);
		await expect(main).toContainText("7 of 10 (95% interval 35% to 93%)");
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const verdict = page.getByRole("region", { name: "Test verdict" });
		await expect(verdict).toContainText("Sample: 1 run");
		await expect(verdict).toContainText("Unconfined");
		await expect(verdict).toContainText("Uncalibrated");
		await expect(verdict).toContainText("Model unpinned");
		await expect(verdict).not.toContainText(RELIABILITY_CLAIM);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

const RELIABILITY_CLAIM = /reliable/i;

async function conditionsFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-conditions-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-00000000000a";
	const testId = "viewer-conditions";
	const catalog = createTestCatalog(config, [
		{
			id: testId,
			file: join(directory, "c.spec.ts"),
			title: "viewer › conditions",
			project: "default",
		},
	]);
	const root = join(executionHistoryRoot(config), executionId);
	const store = await ExecutionStore.create({ root, id: executionId, config });
	await store.setTests([testId]);
	await recordConditionsAttempt(store, testId);
	await store.finish("passed");
	await saveExecutionVerdict(root, conditionsVerdict());
	return { directory, config, catalog, executionId, testId };
}

async function recordConditionsAttempt(store: ExecutionStore, testId: string) {
	const attemptId = "attempt-1";
	await store.record({
		type: "attempt.started",
		level: "info",
		attemptId,
		data: { testId, title: ["viewer", "conditions"], project: "default", retry: 0 },
	});
	await store.record({
		type: "operation.start",
		level: "debug",
		attemptId,
		operationId: "run-1",
		data: { prompt: "answer", name: "agent", invocationIndex: 0 },
	});
	await store.record({
		type: "operation.complete",
		level: "debug",
		attemptId,
		operationId: "run-1",
		data: {
			output: "done",
			name: "agent",
			record: { host: "cursor", confinement: "detect-only", calibrated: false, modelPinned: false },
		},
	});
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId,
		data: { status: "passed", expectedStatus: "passed", durationMs: 10, errors: [] },
	});
}

function conditionsVerdict(): VerdictResult {
	return {
		verdict: "indicative",
		exitCode: 3,
		tests: {},
		counts: { passed: 0, total: 0 },
		claimVerdicts: { "viewer › a sampled claim": "indicative" },
		claims: [
			{
				claim: "viewer › a sampled claim",
				decision: "measured",
				baseline: { status: "none" },
				arms: [
					{
						passed: 7,
						failed: 3,
						noVerdict: 0,
						total: 10,
						interval: { low: 0.348, high: 0.933 },
						lowerBound: 0.393,
					},
				],
			},
		],
	};
}

const CONTROL = "control fails as it should";
const FLAKY = "flaky passes on retry";
const BROKEN = "real failure";
const STORED_TESTS = [
	{ id: "stored-control", title: CONTROL },
	{ id: "stored-flaky", title: FLAKY },
	{ id: "stored-broken", title: BROKEN },
];

/** One attempt per entry, journaled as the reporter writes them. */
async function recordAttempts(
	store: ExecutionStore,
	attempts: { testId: string; title: string; retry: number; finished: Record<string, unknown> }[],
) {
	for (const { testId, title, retry, finished } of attempts) {
		const attemptId = `${testId}-${retry}`;
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId,
			data: { testId, title: [title], retry, project: "default" },
		});
		await store.record({ type: "attempt.finished", level: "info", attemptId, data: finished });
	}
}

/** The CLI's verdict disagrees with the recorded statuses for both a good control and a flaky test. */
async function storedVerdictFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-stored-verdict-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-00000000000b";
	const root = join(executionHistoryRoot(config), executionId);
	const store = await ExecutionStore.create({ root, id: executionId, config });
	await store.setTests(STORED_TESTS.map(({ id }) => id));
	const failure = { status: "failed", errors: [{ message: "Error: the check failed" }] };
	await recordAttempts(store, [
		{
			testId: "stored-control",
			title: CONTROL,
			retry: 0,
			finished: { ...failure, expectedStatus: "failed" },
		},
		{ testId: "stored-flaky", title: FLAKY, retry: 0, finished: failure },
		{ testId: "stored-flaky", title: FLAKY, retry: 1, finished: { status: "passed" } },
		{ testId: "stored-broken", title: BROKEN, retry: 0, finished: failure },
	]);
	await store.finish("failed");
	await saveExecutionVerdict(root, {
		verdict: "agent_failed",
		exitCode: 1,
		tests: {
			"stored-control": "passed",
			"stored-flaky": "flaky",
			"stored-broken": "agent_failed",
		},
		counts: { passed: 1, total: 3 },
		claims: [],
	});
	const catalog = createTestCatalog(
		config,
		STORED_TESTS.map(({ id, title }) => ({
			id,
			file: join(directory, "stored.spec.ts"),
			title: `stored › ${title}`,
			project: "default",
		})),
	);
	return { directory, config, catalog, executionId };
}

test("the viewer shows the stored verdict, as the CLI reports it", async ({ page }) => {
	const fixture = await storedVerdictFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(viewer.url);
		const main = page.getByRole("main");
		const row = (title: string) => main.getByRole("link").filter({ hasText: title });
		await expect(row(CONTROL)).toContainText("passed");
		await expect(row(CONTROL)).not.toContainText("the check failed");
		await expect(row(FLAKY)).toContainText("flaky");
		await expect(row(BROKEN)).toContainText("failed");
		await expect(main.getByRole("button", { name: "Failed" })).toContainText("1");
		await page.screenshot({
			path: test.info().outputPath("stored-verdict-inbox.png"),
			fullPage: true,
		});

		await row(CONTROL).click();
		const verdict = page.getByRole("region", { name: "Test verdict" });
		await expect(verdict).toContainText("as this control requires");
		await expect(verdict).toContainText("Passed");
		await expect(page.getByRole("button", { name: "Copy failure" })).toHaveCount(0);
		await page.screenshot({
			path: test.info().outputPath("stored-verdict-control.png"),
			fullPage: true,
		});

		await page.goto(
			new URL(`/tests/stored-flaky?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const headlines = page.getByRole("region", { name: "Test verdict" });
		await expect(headlines.first()).toContainText("Failed");
		await expect(headlines.last()).toContainText("Flaky");
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

const VALID_RUN = {
	version: 1,
	config: "c",
	startedAt: "2026-01-02T00:00:00.000Z",
	finishedAt: "2026-01-02T00:00:01.000Z",
	status: "passed",
	testIds: ["stored-control"],
	testStatuses: { "stored-control": "passed" },
};

test("corrupt stored runs render as unknown and leave the page working", async ({ page }) => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-corrupt-e2e-"));
	const config = join(directory, "agent-test.config.ts");
	const runs: Record<string, string> = {
		"aaaa0000-0000-4000-8000-000000000001": JSON.stringify({
			...VALID_RUN,
			id: "aaaa0000-0000-4000-8000-000000000001",
			verdict: { verdict: "passed" },
		}),
		"bbbb0000-0000-4000-8000-000000000002": "{ not json",
		"cccc0000-0000-4000-8000-000000000003":
			'{"id":"cccc0000-0000-4000-8000-000000000003","startedAt":7,"testIds":5,"status":"odd"}',
	};
	for (const [id, content] of Object.entries(runs)) {
		const root = join(executionHistoryRoot(config), id);
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "execution.json"), content);
	}
	const catalog = createTestCatalog(config, [
		{
			id: "stored-control",
			file: join(directory, "s.spec.ts"),
			title: "s › t",
			project: "default",
		},
	]);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const viewer = await listenViewer({ suitesDir: config, testCatalog: catalog });
	try {
		await page.goto(viewer.url);
		const main = page.getByRole("main");
		await expect(main).toContainText("stored record could not be read");
		await expect(main).toContainText("Earlier runs");
		await expect(main.getByText("Unknown date").first()).toBeVisible();
		await page.screenshot({ path: test.info().outputPath("corrupt-runs.png"), fullPage: true });
		await page.goto(
			new URL("/executions/bbbb0000-0000-4000-8000-000000000002", viewer.url).toString(),
		);
		await expect(main).toContainText("stored record could not be read");
		expect(errors).toEqual([]);
	} finally {
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

/** A second site, for the requests a page a user happens to visit could send to the viewer. */
function listenAttackerSite(html: string): Promise<{ url: string; close: () => void }> {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html" });
		response.end(html);
	});
	return new Promise((resolveSite) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolveSite({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
		});
	});
}

/** Every way a cross-site page can send a POST: the preflighted one must not even get through. */
async function sendCrossSiteRequests(page: Page, target: string) {
	const body = JSON.stringify({ all: true });
	const outcome = await page.evaluate(
		async ({ target, body }) => {
			const send = (init: RequestInit) =>
				fetch(target, { method: "POST", body, ...init }).then(
					() => "sent",
					() => "blocked",
				);
			await send({ mode: "no-cors", headers: { "content-type": "text/plain" } });
			return send({ headers: { "content-type": "application/json" } });
		},
		{ target, body },
	);
	expect(outcome).toBe("blocked");
	const formAnswer = page.waitForResponse(target);
	await page.locator("#f").evaluate((form: HTMLFormElement) => form.submit());
	expect((await formAnswer).status()).toBe(403);
	await page.waitForURL(target);
}

test("a page on another site cannot start a run", async ({ page }) => {
	let starts = 0;
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-csrf-"));
	const config = join(directory, "agent-test.config.ts");
	const viewer = await listenViewer({
		suitesDir: config,
		testCatalog: createTestCatalog(config, []),
		startExecution: async () => {
			starts++;
			return { id: "feed-face", cancel: () => undefined, completed: Promise.resolve(0) };
		},
	});
	const target = new URL("/api/executions", viewer.url).toString();
	const site = await listenAttackerSite(
		`<form id="f" method="post" enctype="text/plain" action="${target}"><input name='{"all":true,"x":"' value='"}'></form>`,
	);
	try {
		await page.goto(site.url);
		await sendCrossSiteRequests(page, target);
		expect(starts).toBe(0);
		await page.goto(viewer.url);
		const answer = await page.evaluate(
			async () =>
				(
					await fetch("/api/executions", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ all: true }),
					})
				).status,
		);
		expect(answer).toBe(202);
		expect(starts).toBe(1);
	} finally {
		site.close();
		await viewer.close();
		await rm(directory, { recursive: true, force: true });
	}
});

async function attachmentsFixture() {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-script-"));
	const config = join(directory, "agent-test.config.ts");
	const executionId = "feed0000-0000-4000-8000-00000000000c";
	const script = "<script>document.cookie='ran=1';parent.ran=true;window.ran=true</script>";
	const files = [
		{ name: "page", contentType: "text/html", content: script },
		{
			name: "drawing",
			contentType: "image/svg+xml",
			content: `<svg xmlns="http://www.w3.org/2000/svg"><script>window.ran=true</script></svg>`,
		},
		{ name: "shot", contentType: "image/png", content: Buffer.from(ONE_PIXEL_PNG, "base64") },
	];
	const attachments = await Promise.all(
		files.map(async ({ name, contentType, content }) => {
			const path = join(directory, name);
			await writeFile(path, content);
			return { name, contentType, path };
		}),
	);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), executionId),
		id: executionId,
		config,
	});
	await recordAttempts(store, [
		{
			testId: "stored-control",
			title: "attaches files",
			retry: 0,
			finished: { status: "passed", attachments },
		},
	]);
	await store.finish("passed");
	return { directory, config, executionId };
}

test("an agent-written attachment downloads instead of running, and images still show", async ({
	page,
}) => {
	const fixture = await attachmentsFixture();
	const viewer = await listenViewer({
		suitesDir: fixture.config,
		testCatalog: createTestCatalog(fixture.config, []),
	});
	const attachment = (index: number) =>
		new URL(
			`/api/executions/${fixture.executionId}/attempts/0/attachments/${index}`,
			viewer.url,
		).toString();
	try {
		await page.goto(viewer.url);
		for (const index of [0, 1]) {
			const download = page.waitForEvent("download");
			await page.evaluate((href) => {
				const link = document.createElement("a");
				link.href = href;
				document.body.append(link);
				link.click();
			}, attachment(index));
			await download;
			expect(await page.evaluate(() => "ran" in window)).toBe(false);
			expect(await page.evaluate(() => document.cookie)).toBe("");
		}
		await page.goto(attachment(2));
		const image = page.locator("img");
		await expect(image).toBeVisible();
		expect(await image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});
