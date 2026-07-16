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
		return `<p class="muted">No judge verdicts.</p>`;
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
		return `<p class="muted">No assertion failures.</p>`;
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
	return `
<details class="scenario ${statusClass(result)}"${open}>
  <summary>
    <span class="badge ${statusClass(result)}">${statusLabel(result)}</span>
    <span class="scenario-name">${escapeHtml(result.scenario)}</span>
    <span class="duration">${escapeHtml(formatDuration(result.durationMs))}</span>
  </summary>
  <section>
    <h3>Failures</h3>
    ${renderFailures(result)}
  </section>
  <section>
    <h3>Judge</h3>
    ${renderJudgeVerdicts(result)}
  </section>
  <section>
    <h3>Conversation</h3>
    ${renderMessages(result.trace)}
  </section>
</details>`;
}

function renderSuite(report: SuiteRunReport): string {
	const scenarios = report.results.map(renderScenario).join("\n");
	return `
<section class="suite">
  <h2>${escapeHtml(report.suite)} <span class="muted">(${escapeHtml(report.host)})</span></h2>
  <p class="suite-counts">
    ${report.passed} passed · ${report.failed} failed · ${report.skipped} skipped
  </p>
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
    line-height: 1.5;
  }
  main { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.35rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; }
  h3 { font-size: 1rem; margin: 1rem 0 0.4rem; }
  h4 { font-size: 0.9rem; margin: 1rem 0 0.35rem; color: var(--muted); }
  .muted { color: var(--muted); }
  .summary {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.15rem;
  }
  .summary dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 1rem;
    margin: 0.75rem 0 0;
  }
  .summary dt { color: var(--muted); }
  .summary dd { margin: 0; }
  .suite-counts { color: var(--muted); margin: 0 0 1rem; }
  details.scenario {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin: 0.65rem 0;
    padding: 0.65rem 0.9rem 0.9rem;
  }
  details.scenario summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    align-items: center;
    list-style: none;
  }
  details.scenario summary::-webkit-details-marker { display: none; }
  .scenario-name { font-weight: 600; }
  .duration { color: var(--muted); margin-left: auto; font-variant-numeric: tabular-nums; }
  .badge {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  .status-passed, .badge-pass { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 40%, transparent); }
  .status-failed, .badge-fail { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, transparent); }
  .status-skipped { color: var(--skip); border-color: color-mix(in srgb, var(--skip) 40%, transparent); }
  .failures, .tool-calls, .shell-commands { margin: 0; padding-left: 1.1rem; }
  .failures li, .tool-calls li, .shell-commands li { margin: 0.35rem 0; }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #0b1017;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.65rem 0.75rem;
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
  }
  .message {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 0.55rem 0;
    overflow: hidden;
  }
  .message header {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.35rem 0.65rem;
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
    padding: 0.65rem 0.75rem;
    margin: 0.55rem 0;
  }
  .verdict header { display: flex; gap: 0.5rem; align-items: center; }
  .question { margin: 0.4rem 0 0; }
  .rationale { margin-top: 0.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
</style>
</head>
<body>
<main>
  <h1>agent-test report</h1>
  <div class="summary">
    <p>${totalPassed} passed · ${totalFailed} failed · ${totalSkipped} skipped</p>
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
