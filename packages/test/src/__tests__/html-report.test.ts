import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
		host: "cursor",
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
						failures: [{ matcher: "mustInclude", message: "missing <b>tag</b>" }],
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
						total: {
							totalTokens: 1234,
							inputTokens: 800,
							outputTokens: 434,
							cacheReadTokens: 12,
						},
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
				makeResult({
					scenario: "other",
					usage: { total: { totalTokens: 4000, inputTokens: 3000, outputTokens: 1000 } },
				}),
			]),
		]);
		expect(html).toContain("1,234 tokens");
		expect(html).toContain(">1,234<");
		expect(html).toContain("Typical");
		expect(html).toContain("Largest");
		expect(html).toContain("Token cost");
		expect(html).toContain("How to read this report");
		expect(html).toContain('<section class="guide"');
		expect(html).not.toContain('<details class="guide"');
		expect(html).toContain("Cache read");
		expect(html).toContain("Skills invoked");
		expect(html).toContain("skeleton");
		expect(html).toContain("medium");
		expect(html).not.toContain("1.2k tokens");
	});

	it("prepends the original prompt when the trace omits the user turn", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					prompt: "Reply with the word smoke <ok>",
					trace: {
						messages: [{ role: "assistant", content: "smoke ok" }],
						toolCalls: [],
						shellCommands: [],
						artifacts: {},
					},
				}),
			]),
		]);
		const promptIdx = html.indexOf("Reply with the word smoke &lt;ok&gt;");
		const replyIdx = html.indexOf("smoke ok");
		expect(promptIdx).toBeGreaterThan(-1);
		expect(replyIdx).toBeGreaterThan(promptIdx);
		expect(html).toContain('bubble-label">User');
	});

	it("does not duplicate a user turn that already matches the prompt", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					prompt: "Say hi <script>",
					trace: {
						messages: [
							{ role: "user", content: "Say hi <script>" },
							{ role: "assistant", content: "Hello" },
						],
						toolCalls: [],
						shellCommands: [],
						artifacts: {},
					},
				}),
			]),
		]);
		expect(html.split("Say hi &lt;script&gt;").length - 1).toBe(1);
	});

	it("renders both compare conversations", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					prompt: "Read word.txt.",
					description: "Checks that two workspaces reply with different words.",
					compare: {
						a: {
							id: "a",
							label: "alpha",
							description: "Reads the alpha workspace word.",
							prompt: "Read word.txt.",
							durationMs: 1200,
							trace: {
								messages: [{ role: "assistant", content: "alpha-compare-a7c1" }],
								toolCalls: [{ name: "Read", args: { path: "word.txt" } }],
								shellCommands: [],
								artifacts: {},
								usage: { totalTokens: 1200, inputTokens: 800, outputTokens: 400 },
							},
						},
						b: {
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
					},
				}),
			]),
		]);
		expect(html).toContain("compare-layout");
		expect(html).toContain("compare-arm-a");
		expect(html).toContain("compare-arm-b");
		expect(html).toContain("Arm A");
		expect(html).toContain("Arm B");
		expect(html).toContain("Checks that two workspaces reply with different words.");
		expect(html).toContain("Reads the alpha workspace word.");
		expect(html).toContain("Reads the beta workspace word.");
		expect(html).toContain("alpha-compare-a7c1");
		expect(html).toContain("beta-compare-b3e9");
		expect(html).toContain("Comparison");
		expect(html).toContain("beta is faster than alpha");
		expect(html).toContain("1.2s");
		expect(html).toContain("1,200");
		expect(html).toContain("900");
		expect(html).toContain("-300");
		const aIdx = html.indexOf("alpha-compare-a7c1");
		const bIdx = html.indexOf("beta-compare-b3e9");
		const cmpIdx = html.indexOf("Comparison");
		expect(aIdx).toBeGreaterThan(-1);
		expect(bIdx).toBeGreaterThan(aIdx);
		expect(cmpIdx).toBeGreaterThan(bIdx);
		expect(html).toContain("compare-scenario");
		expect(html).toContain('compare-scenario" open>');
	});

	it("renders criteria and result from the scenario story", () => {
		const html = renderHtmlReport([
			makeReport([
				makeResult({
					story: {
						criteria: ['reply includes "smoke ok"'],
						result: ['agent replied "smoke ok"', "no tools"],
						verdict: ["all checks passed"],
					},
				}),
			]),
		]);
		expect(html).toContain("Criteria");
		expect(html).toContain("Result");
		expect(html).not.toContain("Tested");
		expect(html).not.toContain("Happened");
		expect(html).not.toContain("Outcome");
		expect(html).toContain("reply includes &quot;smoke ok&quot;");
		expect(html).toContain("no tools");
		expect(html).toContain("all checks passed");
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

	it("lists every host in the report lede", () => {
		const cursor = makeReport([makeResult()]);
		const claude: SuiteRunReport = { ...makeReport([makeResult()]), host: "claude" };
		const html = renderHtmlReport([cursor, claude]);
		expect(html).toContain("cursor, claude");
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

	it("writes to an explicit path and creates missing parents", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-test-report-out-"));
		const outPath = join(root, "nested", "run.html");
		try {
			const path = await writeHtmlReport([makeReport([makeResult()])], {}, outPath);
			expect(path).toBe(outPath);
			expect(await readFile(outPath, "utf8")).toContain("agent-test report");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
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
