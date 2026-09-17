import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { loadSdkCatalog } from "../dist/sdk/viewer.js";
import { ExecutionStore, executionHistoryRoot } from "../src/sdk/execution-store.js";
import { listenViewer } from "../src/viewer/server.js";
import { createTestCatalog } from "../src/viewer/test-catalog.js";

const CANDIDATE_COMPLETED = /candidate · completed/;
const NAMED_OPERATIONS = /named operations/;
const SETUP_VIEW = /view=setup/;
const EXECUTION_LABEL = /^Execution /;
const PASSED_LABEL = /^passed$/;

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
		await waitForPassed(page, 15000);
		await checkSidebarStatus(page, title, "passed");
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

test("failed assertion details belong to the Result region", async ({ page, context }) => {
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
		const result = page.getByRole("region", { name: "Result" });
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

test("agent and judge operations have separate selectable conversations", async ({ page }) => {
	const fixture = await conversationSwitcherFixture();
	const viewer = await listenViewer({ suitesDir: fixture.config, testCatalog: fixture.catalog });
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const conversation = page.getByRole("region", { name: "Conversation" });
		const participants = page.getByRole("tablist", {
			name: "Conversation participants",
		});
		await expect(participants.locator("xpath=preceding-sibling::*[1]")).toHaveAttribute(
			"aria-label",
			"Result",
		);
		await expect(participants.locator("xpath=following-sibling::*[1]")).toHaveAttribute(
			"aria-label",
			"Conversation",
		);
		const agent = participants.getByRole("tab", { name: "agent · Agent" });
		const judge = participants.getByRole("tab", { name: "releaseAdvice · Judge" });
		const runs = conversation.getByRole("tablist", { name: "agent runs" });
		const runOne = runs.getByRole("tab", { name: "Run 1" });
		const runTwo = runs.getByRole("tab", { name: "Run 2" });
		await expect(participants.getByRole("tab")).toHaveCount(2);
		await expect(page.getByText("agent · completed ×2", { exact: true })).toHaveCount(1);
		await checkParticipantChipCss(agent, page.getByText("passed", { exact: true }));
		await expect(agent).toHaveAttribute("aria-selected", "true");
		await expect(judge).toHaveAttribute("aria-selected", "false");
		await expect(runOne).toHaveAttribute("aria-selected", "true");
		await expect(runTwo).toHaveAttribute("aria-selected", "false");
		await runTwo.click();
		await expect(runTwo).toHaveAttribute("aria-selected", "true");
		await checkMarkdownFormatting(conversation);
		await expect(conversation.getByText("The answer identifies the production risk.")).toBeHidden();
		await judge.click();
		await expect(judge).toHaveAttribute("aria-selected", "true");
		await expect(conversation.getByRole("tablist")).toHaveCount(0);
		await checkJudgeReview(conversation);
		await checkJudgeResultExplanations(page.getByRole("region", { name: "Result" }));
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

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

async function checkParticipantChipCss(participant: Locator, status: Locator) {
	const participantCss = await participant.evaluate(compactChipCss);
	const statusCss = await status.evaluate(compactChipCss);
	expect(Number.parseFloat(participantCss.fontSize)).toBeLessThan(
		Number.parseFloat(statusCss.fontSize),
	);
	expect(Number.parseFloat(participantCss.height)).toBeLessThan(
		Number.parseFloat(statusCss.height),
	);
	expect(participantCss.borderRadius).toBe(statusCss.borderRadius);
	expect(participantCss.textTransform).toBe(statusCss.textTransform);
}

function compactChipCss(element: Element) {
	const css = getComputedStyle(element);
	return {
		borderRadius: css.borderRadius,
		fontSize: css.fontSize,
		height: css.height,
		textTransform: css.textTransform,
	};
}

async function checkJudgeReview(conversation: Locator) {
	await expect(conversation.getByRole("heading", { name: "Conversation" })).toBeVisible();
	const findings = conversation.getByRole("region", { name: "Judge response" });
	await expect(findings).toContainText("Explains Risk");
	await expect(findings).toContainText("Suggests Next Step");
	await expect(findings.getByLabel("Passed")).toHaveCount(2);
	await expect(findings).toContainText("It names the production rollback risk.");
	await expect(findings).toContainText("It recommends waiting for a rollback plan.");
	await expect(
		conversation.getByText("Identify the release risk and a practical next step.", { exact: true }),
	).toBeVisible();
	await expect(conversation.getByText("Define rollback", { exact: true })).toBeHidden();
}

async function checkJudgeResultExplanations(result: Locator) {
	const criteria = result.getByRole("region", { name: "Criterion results" });
	await expect(criteria.getByRole("listitem").nth(0)).toContainText(
		"It names the production rollback risk.",
	);
	await expect(criteria.getByRole("listitem").nth(1)).toContainText(
		"It recommends waiting for a rollback plan.",
	);
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
	let detailRequests = 0;
	await page.route(`**/api/executions/${fixture.executionId}`, async (route) => {
		detailRequests++;
		if (detailRequests === 1) await route.continue();
		else await route.abort();
	});
	try {
		await page.goto(
			new URL(`/tests/${fixture.testId}?execution=${fixture.executionId}`, viewer.url).toString(),
		);
		const conversation = page.getByRole("region", { name: "Conversation" });
		const running = conversation.getByRole("status", { name: "Agent is running" });
		await expect(running).toContainText("Running");
		await recordLiveConversation(fixture);
		const completed = page
			.getByRole("tablist", { name: "Conversation participants" })
			.getByRole("tab", { name: "finished · Agent" });
		const participant = page
			.getByRole("tablist", { name: "Conversation participants" })
			.getByRole("tab", { name: "seeded · Agent" });
		await expect(completed).toHaveAttribute("aria-selected", "true");
		await expect(completed.getByRole("status")).toHaveCount(0);
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
		expect(detailRequests).toBe(1);
		await finishRunningExecution(fixture);
		await expect(running).toHaveCount(0);
		await expect(participant.getByRole("status", { name: "seeded is running" })).toHaveCount(0);
	} finally {
		await viewer.close();
		await rm(fixture.directory, { recursive: true, force: true });
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
			criteria: [
				"The judge finds that the answer explains the release risk.",
				"The judge finds that the answer suggests a practical next step.",
			],
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
		operationId: "agent-1",
		output: formattedAgentResponse,
	});
	await store.record({
		...shared,
		type: "operation.evaluation",
		operationId: "judge-1",
		data: {
			name: "releaseAdvice",
			evaluation: { prompt: "Identify the release risk and a practical next step." },
			output: {
				explainsRisk: true,
				suggestsNextStep: true,
				explanations: {
					explainsRisk: "It names the production rollback risk.",
					suggestsNextStep: "It recommends waiting for a rollback plan.",
				},
				reason: "The answer identifies the production risk.",
			},
		},
	});
	await recordAgentOperation({
		store,
		shared,
		operationId: "agent-2",
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
			prompt: "Should we release without a rollback plan?",
			output,
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

async function waitForPassed(page: Page, timeout?: number) {
	const current = page.getByRole("tabpanel", { name: "Current run" });
	await expect(current.locator("span").filter({ hasText: PASSED_LABEL })).toBeVisible({ timeout });
}

async function checkOperationLabels(page: Page) {
	await expect(page.getByText(CANDIDATE_COMPLETED)).toBeVisible();
	await expect(page.getByText(NAMED_OPERATIONS)).toBeVisible();
}

async function checkRunPresentation(page: Page) {
	const current = page.getByRole("tabpanel", { name: "Current run" });
	await expect(current.getByText(EXECUTION_LABEL)).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
	const result = page.getByRole("region", { name: "Result" });
	await expect(result.getByText("Passed — no assertions failed.")).toHaveCount(0);
	await expect(
		result.getByText("The candidate uses fewer tokens than the baseline."),
	).toBeVisible();
	await expect(result.getByText("Mina turn 1", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible();
	const conversation = page.getByRole("region", { name: "Conversation" });
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
	await expect(page.getByText("The candidate uses fewer tokens than the baseline.")).toBeVisible();
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

async function checkExecutionSelection(page: Page, title: string) {
	const firstExecution = new URL(page.url()).searchParams.get("execution");
	expect(firstExecution).toBeTruthy();
	await page.getByRole("button", { name: "Run this test" }).click();
	await expect
		.poll(() => new URL(page.url()).searchParams.get("execution"))
		.not.toBe(firstExecution);
	await waitForPassed(page);
	await page.getByRole("tab", { name: "Run history" }).click();
	await page
		.getByRole("button", { name: new RegExp(`execution ${firstExecution?.slice(0, 8)}`) })
		.click();
	await page.reload();
	await waitForPassed(page);
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
