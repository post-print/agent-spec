import type { Run, Statistics, VariantResult } from "./types.js";
export function statistics(values: (number | undefined)[]): Statistics {
	const available =
		values.length > 0 &&
		values.every((value) => typeof value === "number" && Number.isFinite(value));
	const requireValues = () => {
		if (!available) throw new Error("Metric unavailable: every run must report this metric");
		return values as number[];
	};
	return {
		available,
		count: values.length,
		get mean() {
			const v = requireValues();
			return v.reduce((a, b) => a + b, 0) / v.length;
		},
		get min() {
			return Math.min(...requireValues());
		},
		get max() {
			return Math.max(...requireValues());
		},
	};
}
export function variantResult(runs: Run[]): VariantResult {
	return {
		runs,
		metrics: {
			tokens: {
				input: statistics(runs.map((run) => run.usage.tokens.input)),
				output: statistics(runs.map((run) => run.usage.tokens.output)),
				total: statistics(runs.map((run) => run.usage.tokens.total)),
			},
			durationMs: statistics(runs.map((run) => run.durationMs)),
			toolCalls: statistics(
				runs.map((run) => (run.capabilities.toolCalls ? run.toolCalls.length : undefined)),
			),
		},
	};
}
