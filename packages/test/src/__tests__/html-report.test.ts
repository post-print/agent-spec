import { describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderHtmlReport, writeHtmlReport } from "../html-report.js";
import type { ScenarioResult, SuiteRunReport } from "../types.js";
import type { ViewerBootstrap } from "../viewer/events.js";

function result(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
	return {
		suite: "smoke",
		scenario: "hello",
		passed: false,
		failures: [{ matcher: "mustInclude", message: "missing <b>tag</b>" }],
		durationMs: 42,
		trace: {
			messages: [
				{ role: "user", content: "Say hi <script>" },
				{ role: "assistant", content: "Hello & welcome" },
			],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		},
		...overrides,
	};
}

function report(results: ScenarioResult[]): SuiteRunReport {
	return { suite: "smoke", host: "cursor", passed: 0, failed: 1, skipped: 0, results };
}

function embeddedBootstrap(html: string): ViewerBootstrap {
	const json = html.match(
		/<script type="application\/json" id="bootstrap-data">(.*?)<\/script>/s,
	)?.[1];
	if (!json) throw new Error("bootstrap-data was not embedded");
	return JSON.parse(json) as ViewerBootstrap;
}

describe("html report", () => {
	it("is a self-contained React report with completed run data", () => {
		const html = renderHtmlReport([report([result()])], {
			generatedAt: new Date("2026-07-16T12:00:00.000Z"),
			suitesDir: "fixtures",
		});
		const bootstrap = embeddedBootstrap(html);
		expect(html).toContain("<title>agent-test report</title>");
		expect(html).toContain('<div id="viewer-root"></div>');
		expect(html).toContain("\\u003cscript>");
		expect(html).not.toContain("Say hi <script>");
		expect(bootstrap.capabilities.canRun).toBe(false);
		expect(bootstrap.runs[0]?.status).toBe("completed");
		expect(bootstrap.runs[0]?.reports[0]?.results[0]?.failures[0]?.message).toBe(
			"missing <b>tag</b>",
		);
		expect(bootstrap.reportMeta).toEqual({
			host: "cursor",
			suitesDir: "fixtures",
			generatedAt: "2026-07-16T12:00:00.000Z",
		});
	});

	it("preserves comparison arms for side-by-side evaluation", () => {
		const compared = result({
			compare: {
				arms: [
					{ id: "a", label: "alpha", passed: false, durationMs: 10, failures: [] },
					{ id: "b", label: "beta", passed: true, durationMs: 8, failures: [] },
				],
				gates: [{ metric: "outcome", winner: "b", loser: "a" }],
			},
		});
		const bootstrap = embeddedBootstrap(renderHtmlReport([report([compared])]));
		const compare = bootstrap.runs[0]?.reports[0]?.results[0]?.compare;
		expect(compare?.arms.map((arm) => arm.label)).toEqual(["alpha", "beta"]);
		expect(compare?.gates?.[0]).toEqual({ metric: "outcome", winner: "b", loser: "a" });
	});

	it("writes the complete report to an explicit path", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agent-test-html-report-"));
		const path = join(directory, "nested", "report.html");
		try {
			expect(await writeHtmlReport([report([result()])], {}, path)).toBe(path);
			await access(path);
			expect(await readFile(path, "utf8")).toContain('id="viewer-root"');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
