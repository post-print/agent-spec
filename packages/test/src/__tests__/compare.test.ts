import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	compareSuiteReports,
	formatCompareReportMarkdown,
	loadSuiteRunReport,
	parseComparePairToken,
	writeCompareReport,
} from "../compare.js";
import type { SuiteRunReport } from "../types.js";

function makeReport(suite: string, results: SuiteRunReport["results"]): SuiteRunReport {
	return {
		suite,
		host: "replay",
		passed: results.filter((r) => r.passed && !r.skipped).length,
		failed: results.filter((r) => !r.passed && !r.skipped).length,
		skipped: results.filter((r) => r.skipped).length,
		results,
	};
}

describe("compare", () => {
	it("pairs scenarios and computes deltas", () => {
		const a = makeReport("clean", [
			{
				suite: "clean",
				scenario: "route",
				passed: true,
				failures: [],
				durationMs: 100,
				usage: { totalTokens: 200, inputTokens: 120, outputTokens: 80 },
				trace: {
					messages: [],
					toolCalls: [{ name: "Read", args: { path: ".skeleton/registry.md" } }],
					shellCommands: [],
					artifacts: {},
					skillsInvoked: ["skeleton"],
				},
			},
		]);
		const b = makeReport("messy", [
			{
				suite: "messy",
				scenario: "route",
				passed: false,
				failures: [],
				durationMs: 250,
				usage: { totalTokens: 500, inputTokens: 300, outputTokens: 200 },
				trace: {
					messages: [],
					toolCalls: [
						{ name: "Read", args: { path: "random.md" } },
						{ name: "Read", args: { path: "other.md" } },
					],
					shellCommands: [],
					artifacts: {},
					skillsInvoked: [],
				},
			},
		]);

		const report = compareSuiteReports({
			aLabel: "clean",
			bLabel: "messy",
			a,
			b,
		});
		expect(report.paired).toHaveLength(1);
		expect(report.summary.passRegressions).toBe(1);
		expect(report.paired[0]?.deltas.totalTokens).toBe(300);
		expect(report.paired[0]?.deltas.toolCallCount).toBe(1);
		expect(report.paired[0]?.deltas.registryHopCount).toBe(-1);

		const md = formatCompareReportMarkdown(report);
		expect(md).toContain("route");
		expect(md).toContain("Pass regressions");
	});

	it("writes compare-report.json and markdown", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-compare-"));
		const a = makeReport("a", [
			{
				suite: "a",
				scenario: "x",
				passed: true,
				failures: [],
				durationMs: 1,
			},
		]);
		const b = makeReport("b", [
			{
				suite: "b",
				scenario: "x",
				passed: true,
				failures: [],
				durationMs: 2,
			},
		]);
		const written = await writeCompareReport({
			outDir: dir,
			report: compareSuiteReports({ aLabel: "a", bLabel: "b", a, b }),
		});
		const sideA = join(dir, "side-a.json");
		await writeFile(sideA, `${JSON.stringify(a, null, 2)}\n`, "utf8");
		expect((await loadSuiteRunReport(sideA)).suite).toBe("a");
		expect(written.jsonPath).toContain("compare-report.json");
		expect(written.markdownPath).toContain("compare-report.md");
		expect(written.htmlPath).toContain("compare-report.html");
		const { readFile } = await import("node:fs/promises");
		const html = await readFile(written.htmlPath, "utf8");
		expect(html).toContain("agent-test compare");
		expect(html).toContain("A/B compare");
	});

	it("parses A:B pair tokens", () => {
		expect(parseComparePairToken("skeleton-clean:skeleton-messy")).toEqual({
			a: "skeleton-clean",
			b: "skeleton-messy",
		});
	});
});
