import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentTrace } from "@post-print/agent-harness";

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

function renderMessages(trace: AgentTrace | undefined): string {
	if (!trace) {
		return `<p class="muted">No transcript recorded for this scenario.</p>`;
	}

	const parts: string[] = [];

	if (trace.messages.length > 0) {
		parts.push(`<div class="messages">`);
		for (const message of trace.messages) {
			parts.push(`
<article class="message role-${escapeHtml(message.role)}">
  <header>${escapeHtml(message.role)}</header>
  <pre>${escapeHtml(message.content)}</pre>
</article>`);
		}
		parts.push(`</div>`);
	} else {
		parts.push(`<p class="muted">No messages in transcript.</p>`);
	}

	if (trace.toolCalls.length > 0) {
		parts.push(`<h4>Tool calls</h4><ul class="tool-calls">`);
		for (const call of trace.toolCalls) {
			const args =
				call.args === undefined ? "" : ` <code>${escapeHtml(JSON.stringify(call.args))}</code>`;
			parts.push(`<li><strong>${escapeHtml(call.name)}</strong>${args}</li>`);
		}
		parts.push(`</ul>`);
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
			return `
<article class="verdict verdict-${badge}">
  <header>
    <span class="badge badge-${badge}">${badge}</span>
    <strong>${escapeHtml(verdict.id)}</strong>
  </header>
  <p class="question">${escapeHtml(verdict.question)}</p>
  <pre class="rationale">${escapeHtml(verdict.rationale)}</pre>
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
		.map(
			(failure) => `
<li>
  <strong>${escapeHtml(failure.matcher)}</strong>
  <pre>${escapeHtml(failure.message)}</pre>
</li>`,
		)
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
    ${failures ? `<section><h3>Failures</h3>${failures}</section>` : ""}
    ${judgeVerdicts ? `<section><h3>Judge</h3>${judgeVerdicts}</section>` : ""}
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
    ${renderMessages(result.trace)}
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
    --text: #e7ecf3;
    --muted: #8b9bb4;
    --border: #2a3548;
    --pass: #3dd68c;
    --fail: #f07178;
    --skip: #ffcc66;
    --user: #7aa2f7;
    --assistant: #9ece6a;
    --system: #bb9af7;
    --tool: #e0af68;
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
  h3 { font-size: 0.78rem; margin: 0 0 0.45rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; }
  h4 { font-size: 0.78rem; margin: 0.8rem 0 0.3rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .muted { color: var(--muted); }
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
  .status-passed, .badge-pass { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 40%, transparent); }
  .status-failed, .badge-fail { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, transparent); }
  .status-skipped { color: var(--skip); border-color: color-mix(in srgb, var(--skip) 40%, transparent); }
  .scenario-body { padding: 0.7rem; }
  .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0.7rem; margin-bottom: 0.7rem; }
  .diagnostics section { background: #141c28; border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem; min-width: 0; }
  .conversation { min-width: 0; }
  .failures, .tool-calls, .shell-commands { margin: 0; padding-left: 1rem; }
  .failures li, .tool-calls li, .shell-commands li { margin: 0.25rem 0; }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #0b1017;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
    margin: 0.25rem 0 0;
    font-size: 0.8rem;
  }
  .message {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 0.4rem 0;
    overflow: hidden;
  }
  .message header {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.25rem 0.55rem;
    background: #121a26;
  }
  .message.role-user header { color: var(--user); }
  .message.role-assistant header { color: var(--assistant); }
  .message.role-system header { color: var(--system); }
  .message.role-tool header { color: var(--tool); }
  .message pre { border: 0; border-radius: 0; margin: 0; }
  .verdict {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
    margin: 0.35rem 0;
  }
  .verdict header { display: flex; gap: 0.5rem; align-items: center; }
  .question { margin: 0.3rem 0 0; font-size: 0.88rem; }
  .rationale { margin-top: 0.35rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  @media (max-width: 720px) {
    main { padding: 0.75rem; }
    .summary { align-items: flex-start; flex-direction: column; }
    .summary dl { justify-content: flex-start; }
    .suite-header { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
    .diagnostics { grid-template-columns: 1fr; }
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
