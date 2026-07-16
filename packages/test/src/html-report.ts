import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentMessage, AgentToolCall, AgentTrace } from "@post-print/agent-harness";

import type { ScenarioResult, SuiteRunReport } from "./types.js";

export interface HtmlReportMeta {
	generatedAt?: Date;
	host?: string;
	suitesDir?: string;
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
	mustInvokeSkill: {
		label: "Missing skill",
		hint: "The agent didn't read a skill it was expected to use.",
	},
	mustNotInvokeSkill: {
		label: "Unexpected skill",
		hint: "The agent read a skill it should have avoided.",
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
			return `
<li>
  <p class="failure-label">${escapeHtml(label)}</p>
  ${hint ? `<p class="failure-hint">${escapeHtml(hint)}</p>` : ""}
  <p class="failure-message">${escapeHtml(failure.message)}</p>
</li>`;
		})
		.join("\n");

	return `<ul class="failures">${items}</ul>`;
}

function renderScenario(result: ScenarioResult): string {
	const open = result.passed || result.skipped ? "" : " open";
	const failures = renderFailures(result);
	const judgeVerdicts = renderJudgeVerdicts(result);
	const diagnostics =
		failures || judgeVerdicts
			? `<div class="diagnostics">
    ${failures ? `<section><h3>What went wrong</h3>${failures}</section>` : ""}
    ${judgeVerdicts ? `<section><h3>Judge verdict</h3>${judgeVerdicts}</section>` : ""}
  </div>`
			: "";
	return `
<details class="scenario ${statusClass(result)}"${open}>
  <summary>
    <span class="badge ${statusClass(result)}">${statusLabel(result)}</span>
    <span class="scenario-name">${escapeHtml(result.scenario)}</span>
    <span class="duration">${escapeHtml(formatDuration(result.durationMs))}</span>
  </summary>
  <div class="scenario-body">
  ${diagnostics}
  <section class="conversation">
    <h3>Conversation</h3>
    ${renderChat(result.trace)}
  </section>
  </div>
</details>`;
}

function renderSuite(report: SuiteRunReport): string {
	const scenarios = report.results.map(renderScenario).join("\n");
	return `
<section class="suite">
  <header class="suite-header">
    <div><h2>${escapeHtml(report.suite)}</h2><span class="host">${escapeHtml(report.host)}</span></div>
    <p class="suite-counts">${report.passed} passed · ${report.failed} failed · ${report.skipped} skipped</p>
  </header>
  ${scenarios}
</section>`;
}

/** Build a self-contained HTML report for a completed suite run. */
export function renderHtmlReport(reports: SuiteRunReport[], meta: HtmlReportMeta = {}): string {
	const generatedAt = meta.generatedAt ?? new Date();
	const totalPassed = reports.reduce((sum, report) => sum + report.passed, 0);
	const totalFailed = reports.reduce((sum, report) => sum + report.failed, 0);
	const totalSkipped = reports.reduce((sum, report) => sum + report.skipped, 0);
	const host = meta.host ?? reports[0]?.host ?? "unknown";

	const suitesHtml = reports.map(renderSuite).join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-test report</title>
<style>
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
  .stats { display: flex; gap: 0.45rem; align-items: center; }
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
  .suite { margin-top: 1.25rem; }
  .suite-header { display: flex; align-items: end; justify-content: space-between; margin: 0 0 0.5rem; padding: 0 0.2rem; }
  .suite-header > div { display: flex; align-items: center; gap: 0.5rem; }
  .host { color: var(--muted); font-size: 0.72rem; background: var(--panel); border: 1px solid var(--border); border-radius: 999px; padding: 0.1rem 0.4rem; }
  .suite-counts { color: var(--muted); margin: 0; font-size: 0.78rem; }
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
  @media (max-width: 720px) {
    main { padding: 0.75rem; }
    .summary { align-items: flex-start; flex-direction: column; }
    .summary dl { justify-content: flex-start; }
    .suite-header { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
    .diagnostics { grid-template-columns: 1fr; }
    .bubble, .tool-card { max-width: 92%; }
  }
</style>
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
    </div>
    <dl>
      <dt>Host</dt><dd>${escapeHtml(String(host))}</dd>
      <dt>Generated</dt><dd>${escapeHtml(generatedAt.toISOString())}</dd>
      ${meta.suitesDir ? `<dt>Suites</dt><dd>${escapeHtml(meta.suitesDir)}</dd>` : ""}
    </dl>
  </div>
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
