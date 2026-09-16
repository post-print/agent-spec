import { describe, expect, it } from "bun:test";

import type { ViewerCatalog } from "../viewer/catalog.js";
import { formatFailureDebugCopy } from "../viewer/client.js";
import type { ViewerBootstrap } from "../viewer/events.js";
import { renderViewerPage } from "../viewer/page.js";

const catalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "judge",
			description: "A focused comparison suite.",
			hosts: ["cursor", "claude"],
			scenarios: [
				{
					name: "four arms",
					prompt: "Read <needle.txt>.",
					rubric: { judge: ["Which answer is safer?"] },
					compare: [
						{ id: "control", label: "control", prompt: "Control", rubric: {} },
						{ id: "treatment", label: "treatment", prompt: "Treatment", rubric: {} },
					],
					gates: [{ metric: "turns", winner: "treatment", loser: "control" }],
				},
			],
		},
	],
};

function embeddedBootstrap(html: string): ViewerBootstrap {
	const json = html.match(
		/<script type="application\/json" id="bootstrap-data">(.*?)<\/script>/s,
	)?.[1];
	if (!json) throw new Error("bootstrap-data was not embedded");
	return JSON.parse(json) as ViewerBootstrap;
}

describe("viewer page", () => {
	it("copies comparison measurements, gate values, and agent trace for debugging", () => {
		const copied = formatFailureDebugCopy({
			suite: "tour",
			scenario: "compares workflows",
			passed: false,
			durationMs: 15_400,
			failures: [
				{
					matcher: "compareGate:tokens",
					category: "rubric_miss",
					message: "direct detail must use fewer tokens than search detail (actual 67313 vs 63419)",
				},
			],
			compare: {
				arms: [
					{
						id: "search-detail",
						label: "search then detail",
						prompt: "Search, then get detail.",
						passed: true,
						trace: {
							messages: [
								{ role: "user", content: "Search TASK-104." },
								{ role: "assistant", content: "2026-09-24" },
							],
							toolCalls: [{ name: "tasks:search_tasks", args: { id: "TASK-104" } }],
							shellCommands: [],
							artifacts: {},
							usage: { inputTokens: 63_284, outputTokens: 135, totalTokens: 63_419 },
						},
					},
					{
						id: "direct-detail",
						label: "direct detail",
						prompt: "Get TASK-104 directly.",
						passed: true,
						trace: {
							messages: [],
							toolCalls: [{ name: "tasks:get_task", args: { id: "TASK-104" } }],
							shellCommands: [],
							artifacts: {},
							usage: { inputTokens: 67_192, outputTokens: 121, totalTokens: 67_313 },
						},
					},
				],
				gateResults: [
					{
						gate: { metric: "tokens", winner: "direct-detail", loser: "search-detail" },
						passed: false,
						left: 67_313,
						right: 63_419,
						message: "direct detail must use fewer tokens than search detail",
					},
				],
			},
		});

		expect(copied).toContain("## Comparison measurements");
		expect(copied).toContain("63,419 total (63,284 in / 135 out)");
		expect(copied).toContain("67,313 total (67,192 in / 121 out)");
		expect(copied).toContain('tasks:get_task {"id":"TASK-104"}');
		expect(copied).toContain("FAIL: direct detail must use fewer tokens than search detail");
	});

	it("renders a React shell with one escaped catalog and bootstrap payload", () => {
		const html = renderViewerPage(catalog);
		expect(html).toContain("<title>agent-test viewer</title>");
		expect(html).toContain('<div id="viewer-root"></div>');
		expect(html.split('id="catalog-data"').length - 1).toBe(1);
		expect(html.split('id="bootstrap-data"').length - 1).toBe(1);
		expect(html).toContain("\\u003cneedle.txt>");
		expect(html).not.toContain("syncScenarioHostChoices");
		expect(html).not.toContain("Context delivery");
		expect(embeddedBootstrap(html).catalog).toEqual(catalog);
		expect(embeddedBootstrap(html).selectedRunId).toBeUndefined();
	});

	it("preserves run and comparison data for the React client", () => {
		const bootstrap: ViewerBootstrap = {
			catalog,
			runs: [
				{
					id: "run-1",
					request: { suite: "judge" },
					status: "running",
					startedAt: "2026-09-15T00:00:00.000Z",
					reports: [],
				},
			],
			selectedRunId: "run-1",
			capabilities: { canRun: true },
		};
		const embedded = embeddedBootstrap(renderViewerPage(bootstrap));
		expect(embedded.selectedRunId).toBe("run-1");
		expect(embedded.runs[0]?.request).toEqual({ suite: "judge" });
		expect(embedded.catalog.suites[0]?.scenarios[0]?.compare).toHaveLength(2);
		expect(embedded.catalog.suites[0]?.scenarios[0]?.gates?.[0]).toEqual({
			metric: "turns",
			winner: "treatment",
			loser: "control",
		});
	});
});
