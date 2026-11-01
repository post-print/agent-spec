/** Exact statistics for "k of n runs passed". Pure, so every number is tested directly. */
const BISECTION_STEPS = 60;
const Z_95 = 1.959_963_985;

function logChoose(n: number, k: number): number {
	let total = 0;
	for (let index = 1; index <= k; index++) total += Math.log((n - k + index) / index);
	return total;
}
function binomialTerm(n: number, k: number, p: number): number {
	if (p <= 0) return k === 0 ? 1 : 0;
	if (p >= 1) return k === n ? 1 : 0;
	return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
/** P(X <= k) for X ~ Binomial(n, p). */
export function binomialCdf(k: number, n: number, p: number): number {
	let total = 0;
	for (let value = 0; value <= Math.min(k, n); value++) total += binomialTerm(n, value, p);
	return Math.min(total, 1);
}
/** The p where a function that increases with p crosses the target. */
function solveIncreasing(value: (p: number) => number, target: number): number {
	let low = 0;
	let high = 1;
	for (let step = 0; step < BISECTION_STEPS; step++) {
		const middle = (low + high) / 2;
		if (value(middle) < target) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}
function lowerAt(k: number, n: number, alpha: number): number {
	if (k === 0) return 0;
	return solveIncreasing((p) => 1 - binomialCdf(k - 1, n, p), alpha);
}
function upperAt(k: number, n: number, alpha: number): number {
	if (k === n) return 1;
	return solveIncreasing((p) => 1 - binomialCdf(k, n, p), 1 - alpha);
}
export interface RateInterval {
	low: number;
	high: number;
}
/** Clopper-Pearson: never narrower than the truth, however small n is. */
export function exactInterval(k: number, n: number): RateInterval {
	if (n === 0) return { low: 0, high: 1 };
	return { low: lowerAt(k, n, 0.025), high: upperAt(k, n, 0.025) };
}
/** "p is at least this" with 95% confidence. 20 of 20 gives about 0.861. */
export function lowerBound(k: number, n: number): number {
	return n === 0 ? 0 : lowerAt(k, n, 0.05);
}

export interface SamplingPlan {
	n: number;
	/** Flag the claim at this many failures. */
	flagAt: number;
	falseAlarmRate: number;
	power: number;
}
const MAX_PLAN_SAMPLES = 2_000;
/**
 * The smallest fixed plan that tells `target` from `detect`, computed before any run so a result
 * is never decided by watching an interval move. Stopping once `flagAt` is reached or can no longer
 * be reached does not change the decision, so the error rates stand.
 */
export function samplingPlan(input: {
	target: number;
	detect: number;
	falseAlarm?: number;
	power?: number;
}): SamplingPlan {
	const { target, detect, falseAlarm = 0.05, power = 0.8 } = input;
	for (let n = 1; n <= MAX_PLAN_SAMPLES; n++) {
		for (let flagAt = 1; flagAt <= n; flagAt++) {
			// Failures are Binomial(n, 1 - p); flagging needs at least flagAt of them.
			const falseAlarmRate = 1 - binomialCdf(flagAt - 1, n, 1 - target);
			if (falseAlarmRate > falseAlarm) continue;
			const planPower = 1 - binomialCdf(flagAt - 1, n, 1 - detect);
			if (planPower >= power) return { n, flagAt, falseAlarmRate, power: planPower };
			break;
		}
	}
	throw new Error(`No plan within ${MAX_PLAN_SAMPLES} runs tells ${target} from ${detect}`);
}
/** Whether more runs could change this plan's decision. */
export function planIsDecided(input: { flagAt: number; n: number; failures: number; ran: number }) {
	const { flagAt, n, failures, ran } = input;
	return failures >= flagAt || flagAt - failures > n - ran;
}

function wilson(k: number, n: number): RateInterval {
	if (n === 0) return { low: 0, high: 1 };
	const p = k / n;
	const z2 = Z_95 * Z_95;
	const centre = p + z2 / (2 * n);
	const margin = Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
	const denominator = 1 + z2 / n;
	return {
		low: k === 0 ? 0 : (centre - margin) / denominator,
		high: k === n ? 1 : (centre + margin) / denominator,
	};
}
export interface RateDifference extends RateInterval {
	difference: number;
	/** The interval excludes zero. */
	distinguishable: boolean;
}
/** Newcombe's interval for a difference of two independent rates: first minus second. */
export function differenceInterval(
	first: { passed: number; total: number },
	second: { passed: number; total: number },
): RateDifference {
	const p1 = first.total ? first.passed / first.total : 0;
	const p2 = second.total ? second.passed / second.total : 0;
	const a = wilson(first.passed, first.total);
	const b = wilson(second.passed, second.total);
	const difference = p1 - p2;
	const low = difference - Math.hypot(p1 - a.low, b.high - p2);
	const high = difference + Math.hypot(a.high - p1, p2 - b.low);
	return { difference, low, high, distinguishable: low > 0 || high < 0 };
}
/** Whether k of n is below what the baseline supports, measured against its cautious lower bound. */
export function regressedFrom(
	baseline: { passed: number; total: number },
	current: { passed: number; total: number },
): boolean {
	const floor = lowerBound(baseline.passed, baseline.total);
	return binomialCdf(current.passed, current.total, floor) < 0.05;
}
