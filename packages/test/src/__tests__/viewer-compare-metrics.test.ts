import { describe, expect, it } from "bun:test";

import { renderViewerCompareBoard, summarizeViewerCompare } from "../viewer/compare-metrics.js";

describe("viewer compare metrics", () => {
	it("names the two-arm winner on each metric", () => {
		const summary = summarizeViewerCompare([
			{ id: "a", label: "no skill", turns: 4, tokens: 400, tools: 3, durationMs: 40 },
			{ id: "b", label: "with skill", turns: 2, tokens: 120, tools: 3, durationMs: 20 },
		]);
		expect(summary.metrics.map((metric) => metric.line)).toEqual([
			"Turns: with skill wins (4 vs 2).",
			"Tokens: with skill wins (400 vs 120).",
			"Tools: tie (3 vs 3).",
			"Duration: with skill wins (40 vs 20).",
		]);
		expect(summary.metrics[0]?.winnerIds).toEqual(["b"]);
		expect(summary.gates).toEqual([]);
	});

	it("shows gate results without a four-way winner", () => {
		const summary = summarizeViewerCompare(
			[
				{ id: "skel-clean", label: "skeleton clean", turns: 1, tokens: 80, tools: 1 },
				{ id: "none-clean", label: "no skill clean", turns: 2, tokens: 200, tools: 1 },
				{ id: "skel-messy", label: "skeleton messy", turns: 1, tokens: 90, tools: 1 },
				{ id: "none-messy", label: "no skill messy", turns: 3, tokens: 220, tools: 2 },
			],
			[
				{
					gate: { metric: "tokens", winner: "skel-clean", loser: "none-clean" },
					passed: true,
					left: 80,
					right: 200,
					message: "skel-clean must beat none-clean on tokens",
				},
				{
					gate: { metric: "tokens", winner: "skel-messy", loser: "none-messy" },
					passed: true,
					left: 90,
					right: 220,
					message: "skel-messy must beat none-messy on tokens",
				},
			],
		);
		expect(summary.metrics[1]?.line).toBe(
			"Tokens: lowest is skeleton clean (80 vs 200 vs 90 vs 220).",
		);
		expect(summary.metrics.some((metric) => /wins all|four-way/i.test(metric.line))).toBe(false);
		expect(summary.gates.map((gate) => gate.line)).toEqual([
			"skel-clean must beat none-clean on tokens. Pass.",
			"skel-messy must beat none-messy on tokens. Pass.",
		]);
		expect(summary.gates.every((gate) => gate.passed)).toBe(true);
	});

	it("shows a failed gate", () => {
		const summary = summarizeViewerCompare(
			[
				{ id: "a", label: "control", tokens: 80 },
				{ id: "b", label: "experimental", tokens: 120 },
			],
			[
				{
					gate: { metric: "tokens", winner: "b", loser: "a" },
					passed: false,
					left: 120,
					right: 80,
					message: "b must beat a on tokens",
				},
			],
		);
		expect(summary.gates[0]).toEqual({
			metric: "tokens",
			passed: false,
			line: "b must beat a on tokens. Fail.",
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
