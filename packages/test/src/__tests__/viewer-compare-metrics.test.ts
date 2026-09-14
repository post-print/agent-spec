import { describe, expect, it } from "bun:test";

import { renderViewerCompareBoard, summarizeViewerCompare } from "../viewer/compare-metrics.js";

describe("viewer compare metrics", () => {
	it("names the two-arm winner on each metric", () => {
		const summary = summarizeViewerCompare([
			{ id: "a", label: "no skill", turns: 4, tokens: 400, tools: 3 },
			{ id: "b", label: "with skill", turns: 2, tokens: 120, tools: 3 },
		]);
		expect(summary.metrics.map((metric) => metric.line)).toEqual([
			"Turns: with skill wins (4 vs 2).",
			"Tokens: with skill wins (400 vs 120).",
			"Tools: tie (3 vs 3).",
		]);
		expect(summary.metrics[0]?.winnerIds).toEqual(["b"]);
		expect(summary.gates).toEqual([]);
	});

	it("scores cheaper and faster gates without a four-way winner", () => {
		const summary = summarizeViewerCompare(
			[
				{ id: "skel-clean", label: "skeleton clean", turns: 1, tokens: 80, tools: 1 },
				{ id: "none-clean", label: "no skill clean", turns: 2, tokens: 200, tools: 1 },
				{ id: "skel-messy", label: "skeleton messy", turns: 1, tokens: 90, tools: 1 },
				{ id: "none-messy", label: "no skill messy", turns: 3, tokens: 220, tools: 2 },
			],
			{
				cheaper: [
					{ winner: "skel-clean", loser: "none-clean" },
					{ winner: "skel-messy", loser: "none-messy" },
				],
			},
		);
		expect(summary.metrics[1]?.line).toBe(
			"Tokens: lowest is skeleton clean (80 vs 200 vs 90 vs 220).",
		);
		expect(summary.metrics.some((metric) => /wins all|four-way/i.test(metric.line))).toBe(false);
		expect(summary.gates.map((gate) => gate.line)).toEqual([
			"skeleton clean must use fewer tokens than no skill clean (80 vs 200). Pass.",
			"skeleton messy must use fewer tokens than no skill messy (90 vs 220). Pass.",
		]);
		expect(summary.gates.every((gate) => gate.passed)).toBe(true);
	});

	it("fails a cheaper gate when the named arm does not win", () => {
		const summary = summarizeViewerCompare(
			[
				{ id: "a", label: "control", tokens: 80 },
				{ id: "b", label: "experimental", tokens: 120 },
			],
			{ cheaper: [{ winner: "b", loser: "a" }] },
		);
		expect(summary.gates[0]).toEqual({
			metric: "cheaper",
			passed: false,
			line: "experimental must use fewer tokens than control (120 vs 80). Fail.",
		});
	});

	it("renders a winners list", () => {
		const html = renderViewerCompareBoard(
			summarizeViewerCompare([
				{ id: "a", label: "alpha", turns: 2, tokens: 300, tools: 1 },
				{ id: "b", label: "beta", turns: 1, tokens: 200, tools: 1 },
			]),
		);
		expect(html).toContain("Winners");
		expect(html).toContain("Turns: beta wins (2 vs 1).");
		expect(html).toContain("Tokens: beta wins (300 vs 200).");
		expect(html).toContain("Tools: tie (1 vs 1).");
	});
});
