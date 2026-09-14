import type { Page } from "@playwright/test";
import { writeHtmlReport } from "../../src/html-report.js";
import { listenReportPreview } from "../../src/report-preview.js";
import type { ScenarioResult, SuiteRunReport } from "../../src/types.js";

export interface ReportHarness {
	url: string;
	file: string;
	close: () => Promise<void>;
}

export function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
	return {
		suite: "smoke",
		scenario: "hello",
		passed: true,
		failures: [],
		durationMs: 42,
		...overrides,
	};
}

export function makeReport(
	results: ScenarioResult[],
	overrides: Partial<SuiteRunReport> = {},
): SuiteRunReport {
	return {
		suite: "smoke",
		host: "cursor",
		passed: results.filter((result) => result.passed && !result.skipped).length,
		failed: results.filter((result) => !result.passed && !result.skipped).length,
		skipped: results.filter((result) => result.skipped).length,
		results,
		...overrides,
	};
}

export function e2eReports(): SuiteRunReport[] {
	const sealedPath = "/var/folders/f1/tmp/T/agent-harness-seal-abc/README.md";
	const cursor = makeReport([
		makeResult({
			prompt: "Reply with smoke. <script>window.__xss=1</script>",
			description: "Plain reply.",
			usage: {
				total: { totalTokens: 1234, inputTokens: 800, outputTokens: 434 },
			},
			story: {
				criteria: ['reply includes "smoke"'],
				result: ['agent replied "smoke"', "no tools"],
				verdict: ["all checks passed"],
			},
			trace: {
				messages: [
					{ role: "user", content: "Reply with smoke. <script>window.__xss=1</script>", seq: 0 },
					{ role: "assistant", content: "smoke", seq: 2 },
				],
				toolCalls: [{ name: "Read", args: { path: sealedPath }, seq: 1 }],
				shellCommands: [],
				artifacts: {},
				skillsInvoked: ["skeleton"],
				routing: { tier: "medium" },
				usage: { totalTokens: 1234 },
			},
		}),
		makeResult({
			scenario: "broken",
			passed: false,
			durationMs: 88,
			prompt: "Do not fail.",
			failures: [
				{
					matcher: "mustInclude",
					message: "missing <b>tag</b>",
					category: "rubric_miss",
					evidence: "assistant text omitted the required phrase",
				},
			],
			judgeVerdicts: [
				{
					id: "tone",
					question: "Was the reply helpful?",
					pass: false,
					rationale: "Too curt & vague",
				},
			],
			story: {
				criteria: ['reply omits "WEBHOOK"'],
				result: [],
				verdict: [],
				sections: [
					{
						title: "plain two papers",
						description: "Two Billing papers fight.",
						checks: [{ text: 'reply omits "WEBHOOK"', status: "fail" }],
						notes: ["agent replied CONFLICT WEBHOOK"],
					},
				],
			},
			trace: {
				messages: [{ role: "assistant", content: "CONFLICT WEBHOOK" }],
				toolCalls: [],
				shellCommands: ["echo hi"],
				artifacts: {},
			},
		}),
		makeResult({
			scenario: "mismatch",
			passed: false,
			durationMs: 55,
			failures: [
				{
					matcher: "mustInclude",
					message: "missing <b>tag</b>",
					category: "rubric_miss",
					evidence: "assistant text omitted the required phrase",
				},
			],
		}),
		makeResult({
			scenario: "later",
			skipped: true,
			durationMs: 0,
		}),
		makeResult({
			scenario: "no-trace",
			trace: undefined,
		}),
		makeResult({
			scenario: "legacy",
			trace: {
				messages: [{ role: "assistant", content: "Legacy trace message" }],
				toolCalls: [{ name: "Shell", args: { command: "echo hi" } }],
				shellCommands: ["echo hi"],
				artifacts: {},
			},
		}),
		makeResult({
			suite: "judge",
			scenario: "pair",
			description: "Checks that two workspaces reply with different words.",
			prompt: "Read word.txt.",
			usage: { total: { totalTokens: 2100, inputTokens: 1400, outputTokens: 700 } },
			compare: {
				arms: [
					{
						id: "a",
						label: "alpha",
						description: "Reads the alpha workspace word.",
						prompt: "Read word.txt.",
						durationMs: 1200,
						trace: {
							messages: [
								{ role: "assistant", content: "alpha-compare-a7c1" },
								{ role: "assistant", content: "alpha follow-up" },
							],
							toolCalls: [{ name: "Read", args: { path: "word.txt" } }],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 1200, inputTokens: 800, outputTokens: 400 },
						},
					},
					{
						id: "b",
						label: "beta",
						description: "Reads the beta workspace word.",
						prompt: "Read word.txt.",
						durationMs: 800,
						trace: {
							messages: [{ role: "assistant", content: "beta-compare-b3e9" }],
							toolCalls: [],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 900, inputTokens: 600, outputTokens: 300 },
						},
					},
				],
			},
		}),
		makeResult({
			suite: "judge",
			scenario: "four arms",
			description: "Checks matched skill versus no-skill pairs.",
			prompt: "Answer from the catalog.",
			compare: {
				arms: [
					{
						id: "skel-clean",
						label: "skeleton clean",
						description: "Skill on a clean catalog.",
						prompt: "Answer from the catalog.",
						durationMs: 800,
						trace: {
							messages: [{ role: "assistant", content: "skel-clean-ok" }],
							toolCalls: [],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 80 },
						},
					},
					{
						id: "none-clean",
						label: "no skill clean",
						description: "No skill on a clean catalog.",
						prompt: "Answer from the catalog.",
						durationMs: 1200,
						trace: {
							messages: [{ role: "assistant", content: "none-clean-ok" }],
							toolCalls: [],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 200 },
						},
					},
					{
						id: "skel-messy",
						label: "skeleton messy",
						description: "Skill on a messy catalog.",
						prompt: "Answer from the catalog.",
						durationMs: 900,
						trace: {
							messages: [{ role: "assistant", content: "skel-messy-ok" }],
							toolCalls: [],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 90 },
						},
					},
					{
						id: "none-messy",
						label: "no skill messy",
						description: "No skill on a messy catalog.",
						prompt: "Answer from the catalog.",
						durationMs: 1500,
						trace: {
							messages: [{ role: "assistant", content: "none-messy-ok" }],
							toolCalls: [],
							shellCommands: [],
							artifacts: {},
							usage: { totalTokens: 220 },
						},
					},
				],
				cheaper: [
					{ winner: "skel-clean", loser: "none-clean" },
					{ winner: "skel-messy", loser: "none-messy" },
				],
			},
		}),
	]);
	cursor.suite = "smoke";
	const claude = makeReport(
		[
			makeResult({
				suite: "smoke",
				scenario: "hello",
				usage: { total: { totalTokens: 400, inputTokens: 250, outputTokens: 150 } },
				trace: {
					messages: [{ role: "assistant", content: "smoke from claude" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
			}),
		],
		{ suite: "smoke", host: "claude" },
	);
	return [cursor, claude];
}

export async function openReport(
	page: Page,
	reports: SuiteRunReport[] = e2eReports(),
): Promise<ReportHarness> {
	const file = await writeHtmlReport(reports, {
		generatedAt: new Date("2026-09-14T18:00:00.000Z"),
		suitesDir: "e2e-suites",
	});
	const preview = await listenReportPreview(file);
	await page.goto(preview.url);
	return {
		url: preview.url,
		file,
		close: preview.close,
	};
}

export function scenarioDetails(page: Page, name: string) {
	return page.locator("details.scenario").filter({ hasText: name }).first();
}
