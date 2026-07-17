import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import type { AgentTrace, AgentUsage } from "@post-print/agent-harness";

import type { ScenarioResult, SuiteRunReport } from "./types.js";

export interface ComparePairSpec {
	/** Label for side A (suite name or path basename). */
	aLabel: string;
	/** Label for side B. */
	bLabel: string;
	a: SuiteRunReport;
	b: SuiteRunReport;
}

export interface ScenarioCompareMetrics {
	passed: boolean;
	skipped?: boolean;
	durationMs: number;
	toolCallCount: number;
	skillCount: number;
	/** Read tools whose args mention `.skeleton/registry`. */
	registryHopCount: number;
	/** Skills invoked that look like registry/skill navigation proxies. */
	totalTokens?: number;
	inputTokens?: number;
	outputTokens?: number;
}

export interface ScenarioCompareDelta {
	scenario: string;
	a: ScenarioCompareMetrics;
	b: ScenarioCompareMetrics;
	deltas: {
		passedChanged: boolean;
		durationMs: number;
		toolCallCount: number;
		skillCount: number;
		registryHopCount: number;
		totalTokens?: number;
	};
}

export interface SuiteCompareReport {
	aLabel: string;
	bLabel: string;
	aSuite: string;
	bSuite: string;
	paired: ScenarioCompareDelta[];
	onlyInA: string[];
	onlyInB: string[];
	summary: {
		pairedCount: number;
		passRegressions: number;
		passImprovements: number;
		meanDurationDeltaMs?: number;
		meanToolCallDelta?: number;
		meanTotalTokensDelta?: number;
	};
}

function usageOf(result: ScenarioResult): AgentUsage | undefined {
	return result.usage ?? result.trace?.usage;
}

function registryHopCount(trace: AgentTrace | undefined): number {
	if (!trace) {
		return 0;
	}
	return trace.toolCalls.filter((call) => {
		if (!call.name.toLowerCase().includes("read")) {
			return false;
		}
		return JSON.stringify(call.args ?? {})
			.toLowerCase()
			.includes(".skeleton/registry");
	}).length;
}

export function metricsFromResult(result: ScenarioResult): ScenarioCompareMetrics {
	const usage = usageOf(result);
	const trace = result.trace;
	return {
		passed: result.passed,
		skipped: result.skipped,
		durationMs: result.durationMs,
		toolCallCount: trace?.toolCalls.length ?? 0,
		skillCount: trace?.skillsInvoked?.length ?? 0,
		registryHopCount: registryHopCount(trace),
		totalTokens: usage?.totalTokens,
		inputTokens: usage?.inputTokens,
		outputTokens: usage?.outputTokens,
	};
}

function optionalDelta(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined || b === undefined) {
		return undefined;
	}
	return b - a;
}

function mean(values: number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pair scenarios by shared name across two suite reports. */
export function compareSuiteReports(pair: ComparePairSpec): SuiteCompareReport {
	const aByName = new Map(pair.a.results.map((result) => [result.scenario, result]));
	const bByName = new Map(pair.b.results.map((result) => [result.scenario, result]));
	const names = new Set([...aByName.keys(), ...bByName.keys()]);
	const paired: ScenarioCompareDelta[] = [];
	const onlyInA: string[] = [];
	const onlyInB: string[] = [];

	for (const name of [...names].sort()) {
		const aResult = aByName.get(name);
		const bResult = bByName.get(name);
		if (!aResult) {
			onlyInB.push(name);
			continue;
		}
		if (!bResult) {
			onlyInA.push(name);
			continue;
		}
		const a = metricsFromResult(aResult);
		const b = metricsFromResult(bResult);
		paired.push({
			scenario: name,
			a,
			b,
			deltas: {
				passedChanged: a.passed !== b.passed,
				durationMs: b.durationMs - a.durationMs,
				toolCallCount: b.toolCallCount - a.toolCallCount,
				skillCount: b.skillCount - a.skillCount,
				registryHopCount: b.registryHopCount - a.registryHopCount,
				totalTokens: optionalDelta(a.totalTokens, b.totalTokens),
			},
		});
	}

	const passRegressions = paired.filter((row) => row.a.passed && !row.b.passed).length;
	const passImprovements = paired.filter((row) => !row.a.passed && row.b.passed).length;
	const durationDeltas = paired.map((row) => row.deltas.durationMs);
	const toolDeltas = paired.map((row) => row.deltas.toolCallCount);
	const tokenDeltas = paired
		.map((row) => row.deltas.totalTokens)
		.filter((value): value is number => value !== undefined);

	return {
		aLabel: pair.aLabel,
		bLabel: pair.bLabel,
		aSuite: pair.a.suite,
		bSuite: pair.b.suite,
		paired,
		onlyInA,
		onlyInB,
		summary: {
			pairedCount: paired.length,
			passRegressions,
			passImprovements,
			meanDurationDeltaMs: mean(durationDeltas),
			meanToolCallDelta: mean(toolDeltas),
			meanTotalTokensDelta: mean(tokenDeltas),
		},
	};
}

function formatSigned(value: number | undefined): string {
	if (value === undefined) {
		return "n/a";
	}
	if (value > 0) {
		return `+${value}`;
	}
	return String(value);
}

export function formatCompareReportMarkdown(report: SuiteCompareReport): string {
	const lines: string[] = [
		`# Suite compare: ${report.aLabel} vs ${report.bLabel}`,
		"",
		`- A suite: \`${report.aSuite}\` (${report.aLabel})`,
		`- B suite: \`${report.bSuite}\` (${report.bLabel})`,
		`- Paired scenarios: ${report.summary.pairedCount}`,
		`- Pass regressions (A pass → B fail): ${report.summary.passRegressions}`,
		`- Pass improvements (A fail → B pass): ${report.summary.passImprovements}`,
		`- Mean Δ durationMs (B−A): ${formatSigned(
			report.summary.meanDurationDeltaMs !== undefined
				? Math.round(report.summary.meanDurationDeltaMs)
				: undefined,
		)}`,
		`- Mean Δ toolCallCount (B−A): ${formatSigned(
			report.summary.meanToolCallDelta !== undefined
				? Math.round(report.summary.meanToolCallDelta)
				: undefined,
		)}`,
		`- Mean Δ totalTokens (B−A): ${formatSigned(
			report.summary.meanTotalTokensDelta !== undefined
				? Math.round(report.summary.meanTotalTokensDelta)
				: undefined,
		)}`,
		"",
	];

	if (report.onlyInA.length > 0) {
		lines.push("## Only in A", "", ...report.onlyInA.map((name) => `- ${name}`), "");
	}
	if (report.onlyInB.length > 0) {
		lines.push("## Only in B", "", ...report.onlyInB.map((name) => `- ${name}`), "");
	}

	lines.push("## Per-scenario deltas", "");
	lines.push(
		"| Scenario | A pass | B pass | Δ durationMs | Δ tools | Δ skills | Δ registry hops | Δ totalTokens |",
		"| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
	);
	for (const row of report.paired) {
		lines.push(
			`| ${row.scenario} | ${row.a.passed ? "pass" : "fail"} | ${row.b.passed ? "pass" : "fail"} | ${formatSigned(row.deltas.durationMs)} | ${formatSigned(row.deltas.toolCallCount)} | ${formatSigned(row.deltas.skillCount)} | ${formatSigned(row.deltas.registryHopCount)} | ${formatSigned(row.deltas.totalTokens)} |`,
		);
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function isSuiteRunReport(value: unknown): value is SuiteRunReport {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return typeof record.suite === "string" && Array.isArray(record.results);
}

/** Load a SuiteRunReport JSON dump (single report or `{ reports: [...] }` taking the first). */
export async function loadSuiteRunReport(path: string): Promise<SuiteRunReport> {
	const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (isSuiteRunReport(raw)) {
		return raw;
	}
	if (raw && typeof raw === "object" && Array.isArray((raw as { reports?: unknown }).reports)) {
		const first = (raw as { reports: unknown[] }).reports[0];
		if (isSuiteRunReport(first)) {
			return first;
		}
	}
	throw new Error(`invalid suite report JSON: ${path}`);
}

export interface WriteCompareReportOptions {
	outDir: string;
	report: SuiteCompareReport;
}

export async function writeCompareReport(
	options: WriteCompareReportOptions,
): Promise<{ jsonPath: string; markdownPath: string; htmlPath: string }> {
	const { renderCompareHtmlReport } = await import("./html-report.js");
	await mkdir(options.outDir, { recursive: true });
	const jsonPath = resolve(options.outDir, "compare-report.json");
	const markdownPath = resolve(options.outDir, "compare-report.md");
	const htmlPath = resolve(options.outDir, "compare-report.html");
	await writeFile(jsonPath, `${JSON.stringify(options.report, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, formatCompareReportMarkdown(options.report), "utf8");
	await writeFile(htmlPath, renderCompareHtmlReport(options.report), "utf8");
	return { jsonPath, markdownPath, htmlPath };
}

/** Parse `a:b` pair tokens into absolute/relative path sides. */
export function parseComparePairToken(token: string): { a: string; b: string } {
	const separator = token.includes(":") ? ":" : undefined;
	if (!separator) {
		throw new Error("--compare-pairs requires A:B (two suite dirs or report JSON paths)");
	}
	// Allow Windows drive letters by splitting on the last colon when both sides look like paths
	// with a single colon separator between them (suite-a:suite-b).
	const idx = token.indexOf(":");
	const a = token.slice(0, idx).trim();
	const b = token.slice(idx + 1).trim();
	if (!a || !b) {
		throw new Error("--compare-pairs requires non-empty A and B sides");
	}
	return { a, b };
}

export function labelForCompareSide(side: string): string {
	const base = basename(side.replace(/\/$/, ""));
	return base.endsWith(".json") ? basename(dirname(side)) || base : base;
}
