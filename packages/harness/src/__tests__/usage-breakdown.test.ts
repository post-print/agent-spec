import { describe, expect, it } from "bun:test";

import { buildScenarioUsageBreakdown, sumUsageParts } from "../usage-breakdown.js";

describe("usage-breakdown", () => {
	it("sums agent and judge into total", () => {
		const breakdown = buildScenarioUsageBreakdown(
			{ inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			{ inputTokens: 20, outputTokens: 10, totalTokens: 30 },
		);
		expect(breakdown?.total).toEqual({
			inputTokens: 120,
			outputTokens: 60,
			totalTokens: 180,
		});
	});

	it("returns undefined when both sides absent", () => {
		expect(buildScenarioUsageBreakdown(undefined, undefined)).toBeUndefined();
	});

	it("sumUsageParts merges multiple judge criteria", () => {
		expect(
			sumUsageParts([
				{ totalTokens: 10, inputTokens: 6, outputTokens: 4 },
				{ totalTokens: 20, inputTokens: 12, outputTokens: 8 },
			]),
		).toEqual({ totalTokens: 30, inputTokens: 18, outputTokens: 12 });
	});
});
