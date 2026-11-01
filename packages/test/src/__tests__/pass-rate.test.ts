import { describe, expect, it } from "bun:test";
import {
	differenceInterval,
	exactInterval,
	lowerBound,
	planIsDecided,
	regressedFrom,
	samplingPlan,
} from "../sdk/pass-rate.js";

let seed = 12_345;
function nextRandom(): number {
	seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
	return seed / 2_147_483_648;
}
/** One sequential run of a plan, where each sample truly passes 95% of the time. */
function runPlanOnce(n: number, flagAt: number) {
	let failures = 0;
	let ran = 0;
	while (!planIsDecided({ flagAt, n, failures, ran })) {
		ran += 1;
		if (nextRandom() >= 0.95) failures += 1;
	}
	return { ran, flagged: failures >= flagAt };
}

describe("lower bound and interval", () => {
	it("match the exact values the plan rests on", () => {
		expect(lowerBound(20, 20)).toBeCloseTo(0.861, 3);
		expect(lowerBound(3, 3)).toBeCloseTo(0.368, 3);
		expect(exactInterval(20, 20).low).toBeCloseTo(0.832, 3);
		expect(lowerBound(59, 59)).toBeGreaterThan(0.95);
		expect(lowerBound(299, 299)).toBeGreaterThan(0.99);
	});
	it("handles the edges and contains the observed rate", () => {
		expect(exactInterval(0, 0)).toEqual({ low: 0, high: 1 });
		expect(exactInterval(0, 10).low).toBe(0);
		expect(exactInterval(10, 10).high).toBe(1);
		const { low, high } = exactInterval(7, 10);
		expect(low).toBeLessThan(0.7);
		expect(high).toBeGreaterThan(0.7);
		expect(low).toBeCloseTo(0.348, 2);
		expect(high).toBeCloseTo(0.933, 2);
	});
});

describe("samplingPlan", () => {
	it("finds the plan for telling 95% from 80%", () => {
		expect(samplingPlan({ target: 0.95, detect: 0.8 })).toMatchObject({ n: 27, flagAt: 4 });
		expect(samplingPlan({ target: 0.95, detect: 0.8, power: 0.9 })).toMatchObject({
			n: 38,
			flagAt: 5,
		});
		expect(samplingPlan({ target: 0.99, detect: 0.9 })).toMatchObject({ n: 29, flagAt: 2 });
	});
	it("states the error rates it guarantees", () => {
		const plan = samplingPlan({ target: 0.95, detect: 0.8 });
		expect(plan.falseAlarmRate).toBeCloseTo(0.044, 3);
		expect(plan.power).toBeCloseTo(0.82, 2);
	});
	it("stopping early does not change the false alarm rate", () => {
		const { n, flagAt } = samplingPlan({ target: 0.95, detect: 0.8 });
		const trials = 20_000;
		const results = Array.from({ length: trials }, () => runPlanOnce(n, flagAt));
		const alarms = results.filter(({ flagged }) => flagged).length;
		const runs = results.reduce((total, { ran }) => total + ran, 0);
		expect(alarms / trials).toBeLessThanOrEqual(0.05);
		expect(runs / trials).toBeLessThan(n);
	});
});

describe("planIsDecided", () => {
	it("decides at the flag, or once the flag cannot be reached", () => {
		expect(planIsDecided({ flagAt: 4, n: 27, failures: 4, ran: 10 })).toBe(true);
		expect(planIsDecided({ flagAt: 4, n: 27, failures: 0, ran: 24 })).toBe(true);
		expect(planIsDecided({ flagAt: 4, n: 27, failures: 0, ran: 23 })).toBe(false);
		expect(planIsDecided({ flagAt: 4, n: 27, failures: 3, ran: 26 })).toBe(false);
	});
});

describe("differenceInterval", () => {
	it("separates clearly different arms", () => {
		const result = differenceInterval({ passed: 5, total: 5 }, { passed: 0, total: 5 });
		expect(result.difference).toBe(1);
		expect(result.distinguishable).toBe(true);
	});
	it("does not claim a difference small samples cannot show", () => {
		const result = differenceInterval({ passed: 4, total: 5 }, { passed: 3, total: 5 });
		expect(result.distinguishable).toBe(false);
		expect(result.low).toBeLessThan(0);
		expect(result.high).toBeGreaterThan(0);
	});
	it("recovers a known difference from simulated arms within its interval", () => {
		const result = differenceInterval({ passed: 180, total: 200 }, { passed: 120, total: 200 });
		expect(result.low).toBeLessThan(0.3);
		expect(result.high).toBeGreaterThan(0.3);
		expect(result.distinguishable).toBe(true);
		expect(result.low).toBeCloseTo(0.216, 2);
	});
});

describe("regressedFrom", () => {
	it("flags a clear drop and tolerates ordinary variation", () => {
		expect(regressedFrom({ passed: 27, total: 27 }, { passed: 15, total: 27 })).toBe(true);
		expect(regressedFrom({ passed: 27, total: 27 }, { passed: 26, total: 27 })).toBe(false);
	});
});
