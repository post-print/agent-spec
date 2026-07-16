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
		expect(html).toContain("missing &lt;b&gt;tag&lt;/b&gt;");
		expect(html).toContain("Say hi &lt;script&gt;");
		expect(html).toContain("Hello &amp; welcome");
		expect(html).toContain("Shell");
		expect(html).toContain("echo hi");
		expect(html).not.toContain("<script>");
		expect(html).toContain("2026-07-16T12:00:00.000Z");
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
