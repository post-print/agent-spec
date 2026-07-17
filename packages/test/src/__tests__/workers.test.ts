import { describe, expect, it, vi } from "vitest";

import { LIVE_WORKERS_SOFT_CAP, normalizeWorkers, parseWorkersFlag } from "../workers.js";

describe("parseWorkersFlag", () => {
	it("parses positive integers", () => {
		expect(parseWorkersFlag("4", "--workers")).toBe(4);
	});

	it("rejects invalid values", () => {
		expect(() => parseWorkersFlag("0", "--workers")).toThrow(/--workers/);
		expect(() => parseWorkersFlag("foo", "AGENT_TEST_WORKERS")).toThrow(/AGENT_TEST_WORKERS/);
		expect(() => parseWorkersFlag("1.5", "--workers")).toThrow(/--workers/);
	});
});

describe("normalizeWorkers", () => {
	it("defaults to 1", () => {
		expect(normalizeWorkers({ scenarioCount: 5 })).toBe(1);
	});

	it("clamps to scenario count", () => {
		expect(normalizeWorkers({ requested: 8, scenarioCount: 3 })).toBe(3);
	});

	it("forces 1 for record-fixtures", () => {
		const warn = vi.fn();
		expect(
			normalizeWorkers({
				requested: 4,
				scenarioCount: 4,
				recordFixtures: true,
				warn,
			}),
		).toBe(1);
		expect(warn).toHaveBeenCalled();
	});

	it("forces 1 for no-worktree", () => {
		expect(
			normalizeWorkers({
				requested: 3,
				scenarioCount: 3,
				worktree: false,
				warn: () => undefined,
			}),
		).toBe(1);
	});

	it("forces 1 for NO_ISOLATE and scenario filter", () => {
		expect(
			normalizeWorkers({
				requested: 2,
				scenarioCount: 4,
				isolateDisabled: true,
				warn: () => undefined,
			}),
		).toBe(1);
		expect(
			normalizeWorkers({
				requested: 2,
				scenarioCount: 4,
				scenarioFilter: "one",
				warn: () => undefined,
			}),
		).toBe(1);
	});

	it("warns above live soft cap but does not clamp", () => {
		const warn = vi.fn();
		expect(
			normalizeWorkers({
				requested: LIVE_WORKERS_SOFT_CAP + 1,
				scenarioCount: 10,
				isLive: true,
				warn,
			}),
		).toBe(LIVE_WORKERS_SOFT_CAP + 1);
		expect(warn.mock.calls[0]?.[0]).toMatch(/soft live cap/);
	});
});
