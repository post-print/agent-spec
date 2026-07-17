import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	AgentMessage,
	AgentToolCall,
	AgentTrace,
	AgentUsage,
} from "@post-print/agent-harness";

import {
	compareSuiteReports,
	type ScenarioCompareDelta,
	type SuiteCompareReport,
} from "./compare.js";
import { formatUsageStats, summarizeReportResults, summarizeReports } from "./suite-summary.js";
import type { ScenarioResult, SuiteRunReport, UsageStats } from "./types.js";

export interface HtmlReportMeta {
	generatedAt?: Date;
	host?: string;
	suitesDir?: string;
	/**
	 * When two suite reports are present, embed an A/B compare table (default true).
	 * Set false to skip (e.g. unrelated multi-suite runs).
	 */
	includeCompare?: boolean;
	/** Labels for the embedded compare section (defaults to suite names). */
	compareALabel?: string;
	compareBLabel?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(result: ScenarioResult): string {
	if (result.skipped) {
		return "skipped";
	}
	return result.passed ? "passed" : "failed";
}

function statusClass(result: ScenarioResult): string {
	if (result.skipped) {
		return "status-skipped";
	}
	return result.passed ? "status-passed" : "status-failed";
}

/** Human-readable label + one-line explanation for the matcher codes assertRubric/judge emit. */
const MATCHER_LABELS: Record<string, { label: string; hint?: string }> = {
	runAgent: { label: "Agent run", hint: "The agent session itself failed or was cut short." },
	must: {
		label: "Missing requirement",
		hint: "A required behavior did not show up in the transcript.",
	},
	mustNot: { label: "Forbidden behavior", hint: "The agent did something it was told not to do." },
	mustRun: { label: "Missing command", hint: "An expected command never ran." },
	mustCallTool: {
		label: "Missing tool call",
		hint: "An expected tool was never invoked.",
	},
	mustNotCallTool: {
		label: "Forbidden tool call",
		hint: "A tool the scenario forbids was invoked.",
	},
	toHaveCalledTool: {
		label: "Missing tool call",
		hint: "An expected tool was never invoked.",
	},
	toHaveNotCalledTool: {
		label: "Forbidden tool call",
		hint: "A tool the scenario forbids was invoked.",
	},
	mustInvokeSkill: {
		label: "Missing skill",
		hint: "The agent didn't read a skill it was expected to use.",
	},
	mustNotInvokeSkill: {
		label: "Unexpected skill",
		hint: "The agent read a skill it should have avoided.",
	},
	mustReadPath: {
		label: "Missing read path",
		hint: "Expected a Read tool call whose args mention this path fragment (registry-first / grounding).",
	},
	mustNotReadPath: {
		label: "Forbidden read path",
		hint: "A Read tool call mentioned a path the scenario forbids (hallucinated / invented path proxy).",
	},
	toHaveReadPath: {
		label: "Missing read path",
		hint: "Expected a Read tool call whose args mention this path fragment (registry-first / grounding).",
	},
	toHaveNotReadPath: {
		label: "Forbidden read path",
		hint: "A Read tool call mentioned a path the scenario forbids (hallucinated / invented path proxy).",
	},
	routingBlock: { label: "Routing", hint: "The routing announcement didn't match expectations." },
	workingTreeLeak: {
		label: "Working tree leak",
		hint: "The agent's edits leaked outside its isolated worktree.",
	},
	recordTrace: { label: "Recording failed", hint: "Saving the trace to disk failed." },
	judge: { label: "Judge", hint: "The LLM judge flagged this scenario." },
};

function humanizeMatcher(matcher: string): { label: string; hint?: string } {
	const [base] = matcher.split(":");
	const known = MATCHER_LABELS[base ?? matcher];
	if (known) {
		if (matcher.includes(":")) {
			const suffix = matcher.slice(matcher.indexOf(":") + 1);
			return { label: `${known.label} — ${suffix}`, hint: known.hint };
		}
		return known;
	}
	return { label: matcher };
}

const ROLE_META: Record<string, { label: string; side: "left" | "right" | "center" }> = {
	user: { label: "User", side: "right" },
	assistant: { label: "Agent", side: "left" },
	system: { label: "System", side: "center" },
	tool: { label: "Tool", side: "center" },
};

function renderMessageBubble(message: AgentMessage): string {
	const meta = ROLE_META[message.role] ?? { label: message.role, side: "center" };
	return `
<div class="chat-row side-${meta.side}">
  <div class="bubble role-${escapeHtml(message.role)}">
    <div class="bubble-label">${escapeHtml(meta.label)}</div>
    <div class="bubble-text">${escapeHtml(message.content)}</div>
  </div>
</div>`;
}

/** Truncate long single-line arg values so a stray file body doesn't blow up the card. */
function formatArgValue(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const oneLine = text.replaceAll("\n", " ↵ ");
	return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
}

function renderToolArgs(args: Record<string, unknown> | undefined): string {
	const entries = args ? Object.entries(args) : [];
	if (entries.length === 0) {
		return "";
	}
	const rows = entries
		.map(
			([key, value]) =>
				`<div class="tool-arg"><span class="tool-arg-key">${escapeHtml(key)}</span><code>${escapeHtml(formatArgValue(value))}</code></div>`,
		)
		.join("");
	return `<div class="tool-args">${rows}</div>`;
}

function renderToolCallCard(call: AgentToolCall): string {
	return `
<div class="chat-row side-left">
  <div class="tool-card">
    <div class="tool-card-head"><span class="tool-icon">&#9881;</span><span class="tool-name">${escapeHtml(call.name)}</span></div>
    ${renderToolArgs(call.args)}
  </div>
</div>`;
}

type TimelineItem =
	| { kind: "message"; seq: number; message: AgentMessage }
	| { kind: "tool"; seq: number; call: AgentToolCall };

/** Interleave messages and tool calls chronologically when the trace recorded emission order. */
function buildOrderedTimeline(trace: AgentTrace): TimelineItem[] | undefined {
	const items: TimelineItem[] = [
		...trace.messages.map((message) =>
			message.seq === undefined
				? undefined
				: ({ kind: "message", seq: message.seq, message } as const),
		),
		...trace.toolCalls.map((call) =>
			call.seq === undefined ? undefined : ({ kind: "tool", seq: call.seq, call } as const),
		),
	].filter((item): item is TimelineItem => item !== undefined);

	const totalItems = trace.messages.length + trace.toolCalls.length;
	if (items.length !== totalItems || totalItems === 0) {
		return undefined;
	}

	return items.sort((a, b) => a.seq - b.seq);
}

function renderChat(trace: AgentTrace | undefined): string {
	if (!trace) {
		return `<p class="empty">No transcript recorded for this scenario.</p>`;
	}

	const parts: string[] = [];
	const timeline = buildOrderedTimeline(trace);

	if (timeline) {
		parts.push(`<div class="chat">`);
		for (const item of timeline) {
			parts.push(
				item.kind === "message" ? renderMessageBubble(item.message) : renderToolCallCard(item.call),
			);
		}
		parts.push(`</div>`);
	} else if (trace.messages.length > 0 || trace.toolCalls.length > 0) {
		parts.push(
			`<p class="empty note">Emission order wasn't recorded for this trace — messages and tool calls are shown in separate groups below.</p>`,
		);
		if (trace.messages.length > 0) {
			parts.push(`<div class="chat">`);
			for (const message of trace.messages) {
				parts.push(renderMessageBubble(message));
			}
			parts.push(`</div>`);
		}
		if (trace.toolCalls.length > 0) {
			parts.push(`<h4>Tool calls</h4><div class="chat">`);
			for (const call of trace.toolCalls) {
				parts.push(renderToolCallCard(call));
			}
			parts.push(`</div>`);
		}
	} else {
		parts.push(`<p class="empty">No messages in transcript.</p>`);
	}

	if (trace.shellCommands.length > 0) {
		parts.push(`<h4>Shell commands</h4><ul class="shell-commands">`);
		for (const command of trace.shellCommands) {
			parts.push(`<li><code>${escapeHtml(command)}</code></li>`);
		}
		parts.push(`</ul>`);
	}

	return parts.join("\n");
}

function renderJudgeVerdicts(result: ScenarioResult): string {
	const verdicts = result.judgeVerdicts;
	if (!verdicts || verdicts.length === 0) {
		return "";
	}

	const items = verdicts
		.map((verdict) => {
			const badge = verdict.pass ? "pass" : "fail";
			const icon = verdict.pass ? "✓" : "✗";
			return `
<article class="verdict verdict-${badge}">
  <p class="question"><span class="verdict-icon">${icon}</span>${escapeHtml(verdict.question)}</p>
  <p class="rationale">${escapeHtml(verdict.rationale)}</p>
</article>`;
		})
		.join("\n");

	return `<div class="verdicts">${items}</div>`;
}

function renderFailures(result: ScenarioResult): string {
	if (result.failures.length === 0) {
		return "";
	}

	const items = result.failures
		.map((failure) => {
			const { label, hint } = humanizeMatcher(failure.matcher);
			const evidence = failure.evidence
				? `<pre class="failure-evidence">${escapeHtml(failure.evidence)}</pre>`
				: "";
			return `
<li>
  <p class="failure-label">${escapeHtml(label)}</p>
  ${hint ? `<p class="failure-hint">${escapeHtml(hint)}</p>` : ""}
  <p class="failure-message">${escapeHtml(failure.message)}</p>
  ${evidence}
</li>`;
		})
		.join("\n");

	return `<ul class="failures">${items}</ul>`;
}

function usageOf(result: ScenarioResult): AgentUsage | undefined {
	return result.usage ?? result.trace?.usage;
}

function formatTokensBadge(result: ScenarioResult): string | undefined {
	const usage = usageOf(result);
	if (!usage) {
		return undefined;
	}
	if (typeof usage.totalTokens === "number") {
		return `${usage.totalTokens} tok`;
	}
	const parts: string[] = [];
	if (typeof usage.inputTokens === "number") {
		parts.push(`in ${usage.inputTokens}`);
	}
	if (typeof usage.outputTokens === "number") {
		parts.push(`out ${usage.outputTokens}`);
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function renderUsageDetail(usage: AgentUsage | undefined): string {
	if (!usage) {
		return "";
	}
	const rows: Array<[string, number | undefined]> = [
		["Total tokens", usage.totalTokens],
		["Input", usage.inputTokens],
		["Output", usage.outputTokens],
		["Cache read", usage.cacheReadTokens],
		["Cache write", usage.cacheWriteTokens],
		["Reasoning", usage.reasoningTokens],
	];
	const present = rows.filter(([, value]) => typeof value === "number");
	if (present.length === 0) {
		return "";
	}
	const items = present
		.map(
			([label, value]) =>
				`<div class="meta-item"><span class="meta-key">${escapeHtml(label)}</span><span class="meta-val">${value}</span></div>`,
		)
		.join("");
	return `<section class="scenario-meta"><h3>Token usage</h3><div class="meta-grid">${items}</div></section>`;
}

function renderTraceMeta(result: ScenarioResult): string {
	const trace = result.trace;
	if (!trace) {
		return "";
	}
	const skills = trace.skillsInvoked?.length ? trace.skillsInvoked.join(", ") : "(none)";
	const items: Array<[string, string]> = [
		["Messages", String(trace.messages.length)],
		["Tool calls", String(trace.toolCalls.length)],
		["Skills invoked", skills],
		["Routing tier", trace.routing?.tier ?? "(none)"],
	];
	if (result.attempts !== undefined && result.attempts > 1) {
		items.push(["Attempts", String(result.attempts)]);
	}
	const html = items
		.map(
			([label, value]) =>
				`<div class="meta-item"><span class="meta-key">${escapeHtml(label)}</span><span class="meta-val">${escapeHtml(value)}</span></div>`,
		)
		.join("");
	return `<section class="scenario-meta"><h3>Trace stats</h3><div class="meta-grid">${html}</div></section>`;
}

function renderUsageStatsBlock(usage: UsageStats | undefined, title = "Token usage"): string {
	if (!usage) {
		return "";
	}
	const rows: Array<[string, string]> = [
		["Scenarios with usage", String(usage.scenariosWithUsage)],
	];
	if (usage.sumTotalTokens !== undefined) {
		rows.push(["Sum totalTokens", String(usage.sumTotalTokens)]);
	}
	if (usage.p50TotalTokens !== undefined) {
		rows.push(["p50 totalTokens", String(usage.p50TotalTokens)]);
	}
	if (usage.p95TotalTokens !== undefined) {
		rows.push(["p95 totalTokens", String(usage.p95TotalTokens)]);
	}
	if (usage.sumInputTokens !== undefined) {
		rows.push(["Sum input", String(usage.sumInputTokens)]);
	}
	if (usage.sumOutputTokens !== undefined) {
		rows.push(["Sum output", String(usage.sumOutputTokens)]);
	}
	const items = rows
		.map(
			([label, value]) =>
				`<div class="meta-item"><span class="meta-key">${escapeHtml(label)}</span><span class="meta-val">${escapeHtml(value)}</span></div>`,
		)
		.join("");
	return `<section class="usage-summary"><h3>${escapeHtml(title)}</h3><div class="meta-grid">${items}</div><p class="usage-compact muted">${escapeHtml(formatUsageStats(usage))}</p></section>`;
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

function passCell(passed: boolean, skipped?: boolean): string {
	if (skipped) {
		return `<span class="badge status-skipped">skip</span>`;
	}
	return passed
		? `<span class="badge status-passed">pass</span>`
		: `<span class="badge status-failed">fail</span>`;
}

function deltaClass(value: number | undefined): string {
	if (value === undefined || value === 0) {
		return "delta-flat";
	}
	return value > 0 ? "delta-up" : "delta-down";
}

/** Render an A/B compare table (fragment — no document chrome). */
export function renderCompareHtmlSection(report: SuiteCompareReport): string {
	const rows = report.paired
		.map((row: ScenarioCompareDelta) => {
			const regression = row.a.passed && !row.b.passed;
			const improvement = !row.a.passed && row.b.passed;
			const rowClass = regression
				? "compare-regress"
				: improvement
					? "compare-improve"
					: row.deltas.passedChanged
						? "compare-changed"
						: "";
			return `
<tr class="${rowClass}">
  <td class="compare-name">${escapeHtml(row.scenario)}</td>
  <td>${passCell(row.a.passed, row.a.skipped)}</td>
  <td>${passCell(row.b.passed, row.b.skipped)}</td>
  <td class="${deltaClass(row.deltas.durationMs)}">${escapeHtml(formatSigned(row.deltas.durationMs))}</td>
  <td class="${deltaClass(row.deltas.toolCallCount)}">${escapeHtml(formatSigned(row.deltas.toolCallCount))}</td>
  <td class="${deltaClass(row.deltas.skillCount)}">${escapeHtml(formatSigned(row.deltas.skillCount))}</td>
  <td class="${deltaClass(row.deltas.registryHopCount)}">${escapeHtml(formatSigned(row.deltas.registryHopCount))}</td>
  <td class="${deltaClass(row.deltas.totalTokens)}">${escapeHtml(formatSigned(row.deltas.totalTokens))}</td>
</tr>`;
		})
		.join("\n");

	const onlyA =
		report.onlyInA.length > 0
			? `<p class="muted">Only in A (${escapeHtml(report.aLabel)}): ${report.onlyInA.map((n) => escapeHtml(n)).join(", ")}</p>`
			: "";
	const onlyB =
		report.onlyInB.length > 0
			? `<p class="muted">Only in B (${escapeHtml(report.bLabel)}): ${report.onlyInB.map((n) => escapeHtml(n)).join(", ")}</p>`
			: "";

	return `
<section class="compare">
  <header class="compare-header">
    <h2>A/B compare</h2>
    <p class="muted">${escapeHtml(report.aLabel)} → ${escapeHtml(report.bLabel)} · ${report.summary.pairedCount} paired · regressions ${report.summary.passRegressions} · improvements ${report.summary.passImprovements}</p>
  </header>
  <div class="compare-summary meta-grid">
    <div class="meta-item"><span class="meta-key">Mean Δ durationMs</span><span class="meta-val">${escapeHtml(formatSigned(report.summary.meanDurationDeltaMs !== undefined ? Math.round(report.summary.meanDurationDeltaMs) : undefined))}</span></div>
    <div class="meta-item"><span class="meta-key">Mean Δ tools</span><span class="meta-val">${escapeHtml(formatSigned(report.summary.meanToolCallDelta !== undefined ? Math.round(report.summary.meanToolCallDelta) : undefined))}</span></div>
    <div class="meta-item"><span class="meta-key">Mean Δ totalTokens</span><span class="meta-val">${escapeHtml(formatSigned(report.summary.meanTotalTokensDelta !== undefined ? Math.round(report.summary.meanTotalTokensDelta) : undefined))}</span></div>
  </div>
  ${onlyA}
  ${onlyB}
  <div class="compare-table-wrap">
    <table class="compare-table">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>A</th>
          <th>B</th>
          <th>Δ duration</th>
          <th>Δ tools</th>
          <th>Δ skills</th>
          <th>Δ registry</th>
          <th>Δ tokens</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</section>`;
}

/** Standalone compare HTML document (written next to compare-report.json / .md). */
export function renderCompareHtmlReport(
	report: SuiteCompareReport,
	meta: HtmlReportMeta = {},
): string {
	const generatedAt = meta.generatedAt ?? new Date();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-test compare — ${escapeHtml(report.aLabel)} vs ${escapeHtml(report.bLabel)}</title>
<style>${sharedReportCss()}</style>
</head>
<body>
<main>
  <header class="report-header">
    <h1>agent-test compare</h1>
    <span class="report-kicker">${escapeHtml(report.aLabel)} vs ${escapeHtml(report.bLabel)}</span>
  </header>
  <div class="summary">
    <div class="stats">
      <span class="stat"><strong>${report.summary.pairedCount}</strong> paired</span>
      <span class="stat stat-fail"><strong>${report.summary.passRegressions}</strong> regressions</span>
      <span class="stat stat-pass"><strong>${report.summary.passImprovements}</strong> improvements</span>
    </div>
    <dl>
      <dt>Generated</dt><dd>${escapeHtml(generatedAt.toISOString())}</dd>
      <dt>A</dt><dd>${escapeHtml(report.aSuite)}</dd>
      <dt>B</dt><dd>${escapeHtml(report.bSuite)}</dd>
    </dl>
  </div>
  ${renderCompareHtmlSection(report)}
</main>
</body>
</html>
`;
}

function renderScenario(result: ScenarioResult): string {
	const open = result.passed || result.skipped ? "" : " open";
	const failures = renderFailures(result);
	const judgeVerdicts = renderJudgeVerdicts(result);
	const tokens = formatTokensBadge(result);
	const usageDetail = renderUsageDetail(usageOf(result));
	const traceMeta = renderTraceMeta(result);
	const diagnostics =
		failures || judgeVerdicts
			? `<div class="diagnostics">
    ${failures ? `<section><h3>What went wrong</h3>${failures}</section>` : ""}
    ${judgeVerdicts ? `<section><h3>Judge verdict</h3>${judgeVerdicts}</section>` : ""}
  </div>`
			: "";
	const metaRow =
		usageDetail || traceMeta
			? `<div class="diagnostics meta-row">${usageDetail}${traceMeta}</div>`
			: "";
	return `
<details class="scenario ${statusClass(result)}"${open}>
  <summary>
    <span class="badge ${statusClass(result)}">${statusLabel(result)}</span>
    <span class="scenario-name">${escapeHtml(result.scenario)}</span>
    ${tokens ? `<span class="tokens">${escapeHtml(tokens)}</span>` : ""}
    <span class="duration">${escapeHtml(formatDuration(result.durationMs))}</span>
  </summary>
  <div class="scenario-body">
  ${diagnostics}
  ${metaRow}
  <section class="conversation">
    <h3>Conversation</h3>
    ${renderChat(result.trace)}
  </section>
  </div>
</details>`;
}

function renderSuite(report: SuiteRunReport): string {
	const scenarios = report.results.map(renderScenario).join("\n");
	const usage = (report.summary ?? summarizeReportResults(report.results)).usage;
	const usageLine = usage
		? `<p class="suite-usage">${escapeHtml(formatUsageStats(usage))}</p>`
		: "";
	return `
<section class="suite">
  <header class="suite-header">
    <div><h2>${escapeHtml(report.suite)}</h2><span class="host">${escapeHtml(report.host)}</span></div>
    <div class="suite-meta">
      <p class="suite-counts">${report.passed} passed · ${report.failed} failed · ${report.skipped} skipped</p>
      ${usageLine}
    </div>
  </header>
  ${usage ? renderUsageStatsBlock(usage, "Suite token usage") : ""}
  ${scenarios}
</section>`;
}

function sharedReportCss(): string {
	return `
  :root {
    --bg: #0f1419;
    --panel: #1a2332;
    --panel-2: #141c28;
    --text: #e7ecf3;
    --muted: #8b9bb4;
    --border: #2a3548;
    --pass: #3dd68c;
    --fail: #f07178;
    --skip: #ffcc66;
    --user-bubble: #24406b;
    --assistant-bubble: #1f2f26;
    --system-bubble: #241f38;
    --tool: #e0af68;
    --tool-bubble: #2a2214;
    --improve: #3dd68c;
    --regress: #f07178;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.45;
  }
  main { max-width: 1180px; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; }
  h1 { font-size: 1.45rem; margin: 0; letter-spacing: -0.02em; }
  h2 { font-size: 1.1rem; margin: 0; }
  h3 { font-size: 0.78rem; margin: 0 0 0.5rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; }
  h4 { font-size: 0.72rem; margin: 0.9rem 0 0.35rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-size: 0.85rem; font-style: italic; margin: 0; }
  .empty.note { margin-bottom: 0.5rem; }
  .report-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; }
  .report-kicker { color: var(--muted); font-size: 0.78rem; }
  .summary {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.7rem 0.9rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .stats { display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; }
  .stat { padding: 0.3rem 0.55rem; border-radius: 6px; background: #111923; font-size: 0.8rem; }
  .stat strong { font-size: 1rem; margin-right: 0.25rem; }
  .stat-pass strong { color: var(--pass); }
  .stat-fail strong { color: var(--fail); }
  .stat-skip strong { color: var(--skip); }
  .summary dl {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.15rem 1rem;
    margin: 0;
    font-size: 0.78rem;
  }
  .summary dt { color: var(--muted); margin-right: -0.7rem; }
  .summary dd { margin: 0; }
  .report-usage { margin-top: 0.75rem; }
  .suite { margin-top: 1.25rem; }
  .suite-header { display: flex; align-items: end; justify-content: space-between; margin: 0 0 0.5rem; padding: 0 0.2rem; }
  .suite-header > div { display: flex; align-items: center; gap: 0.5rem; }
  .host { color: var(--muted); font-size: 0.72rem; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.4rem; }
  .suite-meta { text-align: right; }
  .suite-counts { color: var(--muted); margin: 0; font-size: 0.78rem; }
  .suite-usage { color: var(--muted); margin: 0.15rem 0 0; font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .tokens { color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  .usage-summary, .scenario-meta {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.65rem 0.7rem;
    margin: 0 0 0.7rem;
  }
  .usage-compact { margin: 0.45rem 0 0; font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.35rem 0.75rem;
  }
  .meta-item { display: flex; flex-direction: column; gap: 0.1rem; }
  .meta-key { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta-val { font-size: 0.88rem; font-variant-numeric: tabular-nums; word-break: break-word; }
  .meta-row { margin-bottom: 0.7rem; }
  details.scenario {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin: 0.45rem 0;
    overflow: hidden;
  }
  details.scenario summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem 0.65rem;
    align-items: center;
    list-style: none;
    padding: 0.55rem 0.7rem;
  }
  details.scenario[open] summary { border-bottom: 1px solid var(--border); background: #17202d; }
  details.scenario summary::-webkit-details-marker { display: none; }
  .scenario-name { font-weight: 600; font-size: 0.9rem; }
  .duration { color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-block;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  .status-passed { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 40%, transparent); }
  .status-failed { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, transparent); }
  .status-skipped { color: var(--skip); border-color: color-mix(in srgb, var(--skip) 40%, transparent); }
  .scenario-body { padding: 0.7rem; }
  .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0.7rem; margin-bottom: 0.9rem; }
  .diagnostics section { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 0.7rem; min-width: 0; }
  .conversation { min-width: 0; }

  .failures { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
  .failures li { border-left: 3px solid var(--fail); padding-left: 0.6rem; }
  .failure-label { margin: 0; font-weight: 600; font-size: 0.85rem; color: var(--fail); }
  .failure-hint { margin: 0.1rem 0 0; font-size: 0.78rem; color: var(--muted); }
  .failure-message { margin: 0.3rem 0 0; font-size: 0.82rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; background: #0b1017; border: 1px solid var(--border); border-radius: 6px; padding: 0.45rem 0.55rem; }
  .failure-evidence { margin: 0.35rem 0 0; font-size: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; color: var(--muted); background: #0b1017; border: 1px dashed var(--border); border-radius: 6px; padding: 0.4rem 0.5rem; }

  .verdicts { display: flex; flex-direction: column; gap: 0.55rem; }
  .verdict { border-left: 3px solid var(--border); padding-left: 0.6rem; }
  .verdict-pass { border-left-color: var(--pass); }
  .verdict-fail { border-left-color: var(--fail); }
  .verdict-icon { display: inline-block; width: 1.1rem; font-weight: 700; }
  .verdict-pass .verdict-icon { color: var(--pass); }
  .verdict-fail .verdict-icon { color: var(--fail); }
  .question { margin: 0; font-size: 0.85rem; font-weight: 600; }
  .rationale { margin: 0.3rem 0 0; font-size: 0.82rem; color: var(--muted); }

  .chat { display: flex; flex-direction: column; gap: 0.5rem; }
  .chat-row { display: flex; }
  .chat-row.side-left { justify-content: flex-start; }
  .chat-row.side-right { justify-content: flex-end; }
  .chat-row.side-center { justify-content: center; }
  .bubble { max-width: 78%; border-radius: 12px; padding: 0.5rem 0.7rem; border: 1px solid var(--border); }
  .bubble-label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 0.25rem; }
  .bubble-text { white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; }
  .bubble.role-user { background: var(--user-bubble); border-top-right-radius: 3px; }
  .bubble.role-assistant { background: var(--assistant-bubble); border-top-left-radius: 3px; }
  .bubble.role-system, .bubble.role-tool { background: var(--system-bubble); font-size: 0.8rem; max-width: 90%; }

  .tool-card {
    max-width: 82%;
    border-radius: 10px;
    padding: 0.5rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--tool) 35%, var(--border));
    background: var(--tool-bubble);
  }
  .tool-card-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--tool);
  }
  .tool-icon { font-size: 0.85rem; }
  .tool-name { font-weight: 700; }
  .tool-args {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.4rem;
    border-top: 1px solid color-mix(in srgb, var(--tool) 20%, var(--border));
  }
  .tool-arg { display: flex; gap: 0.5rem; align-items: baseline; font-size: 0.78rem; }
  .tool-arg-key { color: var(--muted); flex-shrink: 0; }
  .tool-arg code {
    color: var(--text);
    background: #0b1017;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    word-break: break-word;
  }

  .shell-commands { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
  .shell-commands li { font-size: 0.8rem; background: #0b1017; border: 1px solid var(--border); border-radius: 6px; padding: 0.3rem 0.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }

  .compare {
    margin-top: 1.1rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.85rem 0.9rem 1rem;
  }
  .compare-header { margin-bottom: 0.65rem; }
  .compare-header h2 { margin-bottom: 0.2rem; }
  .compare-summary { margin-bottom: 0.75rem; }
  .compare-table-wrap { overflow-x: auto; }
  .compare-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .compare-table th, .compare-table td {
    border-bottom: 1px solid var(--border);
    padding: 0.4rem 0.45rem;
    text-align: left;
    vertical-align: middle;
  }
  .compare-table th { color: var(--muted); font-weight: 600; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .compare-name { font-weight: 600; }
  .compare-regress { background: color-mix(in srgb, var(--regress) 10%, transparent); }
  .compare-improve { background: color-mix(in srgb, var(--improve) 10%, transparent); }
  .delta-up { color: var(--fail); }
  .delta-down { color: var(--pass); }
  .delta-flat { color: var(--muted); }

  @media (max-width: 720px) {
    main { padding: 0.75rem; }
    .summary { align-items: flex-start; flex-direction: column; }
    .summary dl { justify-content: flex-start; }
    .suite-header { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
    .diagnostics { grid-template-columns: 1fr; }
    .bubble, .tool-card { max-width: 92%; }
  }
`;
}

/** Build a self-contained HTML report for a completed suite run. */
export function renderHtmlReport(reports: SuiteRunReport[], meta: HtmlReportMeta = {}): string {
	const generatedAt = meta.generatedAt ?? new Date();
	const totalPassed = reports.reduce((sum, report) => sum + report.passed, 0);
	const totalFailed = reports.reduce((sum, report) => sum + report.failed, 0);
	const totalSkipped = reports.reduce((sum, report) => sum + report.skipped, 0);
	const host = meta.host ?? reports[0]?.host ?? "unknown";
	const runUsage = summarizeReports(reports).usage;

	// Embed A/B only when explicitly requested (compare-pairs / compare labels), not for every 2-suite run.
	const includeCompare =
		reports.length === 2 &&
		(meta.includeCompare === true ||
			meta.compareALabel !== undefined ||
			meta.compareBLabel !== undefined);
	const compareSection =
		includeCompare && reports[0] && reports[1]
			? renderCompareHtmlSection(
					compareSuiteReports({
						aLabel: meta.compareALabel ?? reports[0].suite,
						bLabel: meta.compareBLabel ?? reports[1].suite,
						a: reports[0],
						b: reports[1],
					}),
				)
			: "";

	const suitesHtml = reports.map(renderSuite).join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-test report</title>
<style>${sharedReportCss()}</style>
</head>
<body>
<main>
  <header class="report-header">
    <h1>agent-test report</h1>
    <span class="report-kicker">${reports.length} suite${reports.length === 1 ? "" : "s"}</span>
  </header>
  <div class="summary">
    <div class="stats">
      <span class="stat stat-pass"><strong>${totalPassed}</strong> passed</span>
      <span class="stat stat-fail"><strong>${totalFailed}</strong> failed</span>
      <span class="stat stat-skip"><strong>${totalSkipped}</strong> skipped</span>
      ${
				runUsage?.sumTotalTokens !== undefined
					? `<span class="stat"><strong>${runUsage.sumTotalTokens}</strong> tokens</span>`
					: ""
			}
    </div>
    <dl>
      <dt>Host</dt><dd>${escapeHtml(String(host))}</dd>
      <dt>Generated</dt><dd>${escapeHtml(generatedAt.toISOString())}</dd>
      ${meta.suitesDir ? `<dt>Suites</dt><dd>${escapeHtml(meta.suitesDir)}</dd>` : ""}
      ${
				runUsage?.p50TotalTokens !== undefined
					? `<dt>p50 tokens</dt><dd>${runUsage.p50TotalTokens}</dd>`
					: ""
			}
      ${
				runUsage?.p95TotalTokens !== undefined
					? `<dt>p95 tokens</dt><dd>${runUsage.p95TotalTokens}</dd>`
					: ""
			}
    </dl>
  </div>
  ${runUsage ? `<div class="report-usage">${renderUsageStatsBlock(runUsage, "Run token usage")}</div>` : ""}
  ${compareSection}
  ${suitesHtml}
</main>
</body>
</html>
`;
}

/** Write an HTML report under a fresh temp directory; returns the report file path. */
export async function writeHtmlReport(
	reports: SuiteRunReport[],
	meta: HtmlReportMeta = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "agent-test-report-"));
	const path = join(dir, "report.html");
	const html = renderHtmlReport(reports, meta);
	await writeFile(path, html, "utf8");
	return path;
}
