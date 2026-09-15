import type { CompareGateResult } from "../types.js";

export type ViewerCompareMetricId = "turns" | "tokens" | "tools" | "durationMs";

export interface ViewerArmMetricRow {
	id: string;
	label: string;
	turns?: number;
	tokens?: number;
	tools?: number;
	durationMs?: number;
}

export interface ViewerMetricSummary {
	id: ViewerCompareMetricId;
	label: string;
	winnerIds: string[];
	line: string;
}

export interface ViewerGateSummary {
	metric: string;
	passed: boolean;
	line: string;
}

export interface ViewerCompareSummary {
	metrics: ViewerMetricSummary[];
	gates: ViewerGateSummary[];
}

const METRICS: Array<{ id: ViewerCompareMetricId; label: string }> = [
	{ id: "turns", label: "Turns" },
	{ id: "tokens", label: "Tokens" },
	{ id: "tools", label: "Tools" },
	{ id: "durationMs", label: "Duration" },
];

/** Lower turns, tokens, tool counts, and duration win. Named pairs do not pick one overall winner. */
export function summarizeViewerCompare(
	arms: ViewerArmMetricRow[],
	gates: CompareGateResult[] = [],
): ViewerCompareSummary {
	return {
		metrics: METRICS.map((metric) => summarizeMetric(arms, metric.id, metric.label)),
		gates: gates.map((gate) => ({
			metric: gate.gate.metric,
			passed: gate.passed,
			line: `${gate.message}. ${gate.passed ? "Pass." : "Fail."}`,
		})),
	};
}

/** Markup for the winners list under a compare cell or report. */
export function renderViewerCompareBoard(summary: ViewerCompareSummary): string {
	if (summary.metrics.length === 0 && summary.gates.length === 0) {
		return "";
	}
	const lines = summary.gates.map((gate) => {
		const status = gate.passed ? "compare-winner-pass" : "compare-winner-fail";
		return `<li class="${status}">${escapeHtml(gate.line)}</li>`;
	});
	return lines.length === 0
		? ""
		: `<section class="compare-winners">
  <h3>Decision checks</h3>
  <ul>${lines.join("")}</ul>
</section>`;
}

function summarizeMetric(
	arms: ViewerArmMetricRow[],
	id: ViewerCompareMetricId,
	label: string,
): ViewerMetricSummary {
	const values = arms.map((arm) => arm[id]);
	const numeric = values.filter((value): value is number => typeof value === "number");
	if (numeric.length < 2) {
		return { id, label, winnerIds: [], line: `${label}: n/a.` };
	}
	const lowest = Math.min(...numeric);
	const winners = arms.filter((arm) => arm[id] === lowest);
	const shown = values
		.map((value) => (typeof value === "number" ? String(value) : "n/a"))
		.join(" vs ");
	if (winners.length === 0) {
		return { id, label, winnerIds: [], line: `${label}: n/a.` };
	}
	if (winners.length > 1) {
		const names = joinLabels(winners.map((arm) => arm.label));
		if (arms.length === 2) {
			return {
				id,
				label,
				winnerIds: winners.map((arm) => arm.id),
				line: `${label}: tie (${shown}).`,
			};
		}
		return {
			id,
			label,
			winnerIds: winners.map((arm) => arm.id),
			line: `${label}: lowest is a tie between ${names} (${shown}).`,
		};
	}
	const winner = winners[0];
	if (!winner) {
		return { id, label, winnerIds: [], line: `${label}: n/a.` };
	}
	if (arms.length === 2) {
		return {
			id,
			label,
			winnerIds: [winner.id],
			line: `${label}: ${winner.label} wins (${shown}).`,
		};
	}
	return {
		id,
		label,
		winnerIds: [winner.id],
		line: `${label}: lowest is ${winner.label} (${shown}).`,
	};
}

function joinLabels(labels: string[]): string {
	if (labels.length <= 1) {
		return labels[0] ?? "";
	}
	if (labels.length === 2) {
		return `${labels[0]} and ${labels[1]}`;
	}
	return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
