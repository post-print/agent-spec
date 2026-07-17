import { access, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { renderHtmlReport, writeHtmlReport } from "../html-report.js";
import type { ScenarioResult, SuiteRunReport } from "../types.js";

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
	return {
		suite: "smoke",
		scenario: "hello",
		passed: true,
		failures: [],
		durationMs: 42,
		...overrides,
	};
}

function makeReport(results: ScenarioResult[]): SuiteRunReport {
	return {
		suite: "smoke",
		host: "replay",
		passed: results.filter((r) => r.passed && !r.skipped).length,
		failed: results.filter((r) => !r.passed && !r.skipped).length,
		skipped: results.filter((r) => r.skipped).length,
		results,
	};
}

describe("html-report", () => {
	it("renders conversation, judge verdicts, and failures", () => {
		const html = renderHtmlReport(
			[
				makeReport([
					makeResult({
						passed: false,
						failures: [{ matcher: "must", message: "missing <b>tag</b>" }],
						judgeVerdicts: [
							{
								id: "tone",
								question: "Was the reply helpful?",
								pass: false,
								rationale: "Too curt & vague",
							},
						],
						trace: {
							messages: [
								{ role: "user", content: "Say hi <script>" },
								{ role: "assistant", content: "Hello & welcome" },
							],
							toolCalls: [{ name: "Shell", args: { command: "echo hi" } }],
							shellCommands: ["echo hi"],
							artifacts: {},
						},
					}),
				]),
			],
			{ generatedAt: new Date("2026-07-16T12:00:00.000Z"), suitesDir: "fixtures" },
		);

		expect(html).toContain("agent-test report");
		expect(html).toContain("hello");
		expect(html).toContain("failed");
		expect(html).toContain("Was the reply helpful?");
		expect(html).toContain("Too curt &amp; vague");
		expect(html).toContain("Missing requirement");
		expect(html).toContain("missing &lt;b&gt;tag&lt;/b&gt;");
		expect(html).toContain("Say hi &lt;script&gt;");
		expect(html).toContain("Hello &amp; welcome");
		expect(html).toContain("Shell");
		expect(html).toContain("echo hi");
		expect(html).not.toContain("<script>");
		expect(html).toContain("2026-07-16T12:00:00.000Z");
	});

	it("renders token usage in scenario and suite summary", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					usage: {
						totalTokens: 1234,
						inputTokens: 800,
						outputTokens: 434,
						cacheReadTokens: 12,
					},
					trace: {
						messages: [{ role: "assistant", content: "ok" }],
						toolCalls: [],
						shellCommands: [],
						artifacts: {},
						skillsInvoked: ["skeleton"],
						routing: { tier: "medium" },
						usage: { totalTokens: 1234 },
					},
				}),
			]),
		]);
		expect(html).toContain("1234 tok");
		expect(html).toContain("tokens_sum=1234");
		expect(html).toContain("p50 tokens");
		expect(html).toContain("Token usage");
		expect(html).toContain("Cache read");
		expect(html).toContain("Skills invoked");
		expect(html).toContain("skeleton");
		expect(html).toContain("medium");
	});

	it("renders grounding matcher labels and failure evidence", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					passed: false,
					failures: [
						{
							matcher: "toHaveReadPath",
							message: 'expected Read tool args containing ".skeleton/registry"',
							category: "rubric_miss",
							evidence: "Read toolCalls=[]",
						},
					],
				}),
			]),
		]);
		expect(html).toContain("Missing read path");
		expect(html).toContain("registry-first");
		expect(html).toContain("Read toolCalls=[]");
		expect(html).toContain("failure-evidence");
	});

	it("embeds A/B compare when two suites are present", () => {
		const clean = makeReport([
			makeResult({
				suite: "clean",
				scenario: "route",
				passed: true,
				usage: { totalTokens: 100 },
				trace: {
					messages: [],
					toolCalls: [{ name: "Read", args: { path: ".skeleton/registry.md" } }],
					shellCommands: [],
					artifacts: {},
					skillsInvoked: ["a"],
				},
			}),
		]);
		clean.suite = "clean";
		const messy = makeReport([
			makeResult({
				suite: "messy",
				scenario: "route",
				passed: false,
				usage: { totalTokens: 300 },
				trace: {
					messages: [],
					toolCalls: [{ name: "Read", args: { path: "invented.ts" } }],
					shellCommands: [],
					artifacts: {},
				},
			}),
		]);
		messy.suite = "messy";

		const html = renderHtmlReport([clean, messy], {
			includeCompare: true,
			compareALabel: "skeleton-clean",
			compareBLabel: "skeleton-messy",
		});
		expect(html).toContain("A/B compare");
		expect(html).toContain("skeleton-clean");
		expect(html).toContain("skeleton-messy");
		expect(html).toContain("Δ tokens");
		expect(html).toContain("compare-regress");

		const unrelated = renderHtmlReport([clean, messy]);
		expect(unrelated).not.toContain("A/B compare");
	});

	it("interleaves messages and tool calls chronologically when seq is recorded", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					trace: {
						messages: [
							{ role: "user", content: "Please read the config first.", seq: 0 },
							{ role: "assistant", content: "Config confirms port 8080.", seq: 2 },
						],
						toolCalls: [{ name: "Read", args: { path: "config.json" }, seq: 1 }],
						shellCommands: [],
						artifacts: {},
					},
				}),
			]),
		]);

		const userIdx = html.indexOf("Please read the config first.");
		const toolIdx = html.indexOf("Read");
		const assistantIdx = html.indexOf("Config confirms port 8080.");
		expect(userIdx).toBeGreaterThan(-1);
		expect(toolIdx).toBeGreaterThan(userIdx);
		expect(assistantIdx).toBeGreaterThan(toolIdx);
	});

	it("falls back to grouped sections when seq is missing", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					trace: {
						messages: [{ role: "assistant", content: "Legacy trace message" }],
						toolCalls: [{ name: "Shell", args: { command: "echo hi" } }],
						shellCommands: [],
						artifacts: {},
					},
				}),
			]),
		]);

		expect(html).toContain("Emission order wasn't recorded");
		expect(html).toContain("Legacy trace message");
		expect(html).toContain("Tool calls");
	});

	it("handles missing trace and skipped scenarios", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					scenario: "skipped-one",
					skipped: true,
					durationMs: 0,
				}),
				makeResult({
					scenario: "no-trace",
					trace: undefined,
				}),
			]),
		]);

		expect(html).toContain("skipped-one");
		expect(html).toContain("skipped");
		expect(html).toContain("No transcript recorded");
	});

	it("writes a report file under a temp directory", async () => {
		const path = await writeHtmlReport([makeReport([makeResult()])]);
		try {
			await access(path);
			const contents = await readFile(path, "utf8");
			expect(contents).toContain("agent-test report");
			expect(path).toMatch(/agent-test-report-.*\/report\.html$/);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
});
