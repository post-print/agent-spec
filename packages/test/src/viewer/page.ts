import { describeCompareGate } from "../compare-scenario.js";
import type { ScenarioRubric } from "../types.js";
import type { ViewerCatalog, ViewerCatalogScenario, ViewerCatalogSuite } from "./catalog.js";
import type { ViewerBootstrap } from "./events.js";

export interface ViewerRenderedResult {
	suite: string;
	scenario: string;
	host: string;
	html: string;
}

export interface ViewerPageRenderOptions {
	baseCss?: string;
	headerLede?: string;
	overviewHtml?: string;
	results?: ViewerRenderedResult[];
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function embedJson(value: unknown): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function viewerCss(): string {
	return `
  body { word-spacing: normal; }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1.25rem;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.85rem 1rem;
    margin-bottom: 1.25rem;
  }
  .toolbar-block { display: grid; gap: 0.35rem; }
	.run-history { min-width: min(26rem, 80vw); }
  .toolbar-label { color: var(--muted); font-size: 0.75rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; }
  .host-toggles, .toolbar-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; }
  .host-toggles label { display: inline-flex; gap: 0.35rem; align-items: center; font-size: 0.85rem; }
  button {
    font: inherit;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    padding: 0.35rem 0.65rem;
    cursor: pointer;
  }
  button.primary { background: color-mix(in srgb, var(--pass) 18%, var(--panel-2)); border-color: color-mix(in srgb, var(--pass) 40%, var(--border)); }
  button.danger { border-color: color-mix(in srgb, var(--fail) 40%, var(--border)); color: var(--fail); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .warn { color: var(--skip); font-size: 0.8rem; }
  .scenario-list { display: grid; gap: 0.75rem; }
  .scenario-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.85rem 0.95rem;
    display: grid;
    gap: 0.7rem;
  }
  .scenario-detail { display: grid; gap: 0.35rem; }
  .prompt-preview { color: var(--muted); font-size: 0.78rem; white-space: pre-wrap; }
  .rubric-line { font-size: 0.75rem; color: var(--muted); }
  .arm-note { font-size: 0.78rem; color: var(--muted); }
  .scenario-toolbar { display: flex; flex-wrap: wrap; gap: 0.55rem 0.85rem; align-items: center; }
  .scenario-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .host-tablist { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .host-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .host-tab[aria-selected="true"] {
    background: color-mix(in srgb, var(--pass) 16%, var(--panel-2));
    border-color: color-mix(in srgb, var(--pass) 40%, var(--border));
  }
  .host-tab[data-status="running"],
  .host-tab[data-status="cancelling"],
  .host-tab[data-status="cancelled"] { color: var(--skip); }
  .host-tab[data-status="passed"] { color: var(--pass); }
  .host-tab[data-status="failed"] { color: var(--fail); }
  .host-tab[data-status="skipped"], .host-tab[data-status="skip"] { color: var(--muted); }
  .host-tab[hidden], .host-empty-selection[hidden] { display: none; }
  .host-empty-selection { color: var(--muted); font-size: .78rem; }
  .host-status { display: inline-flex; align-items: center; }
  .cell-status { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; }
  .scenario-live { display: grid; gap: 0.75rem; }
  .scenario-live[hidden], .host-panel[hidden], .host-empty[hidden] { display: none; }
  .host-panels { display: grid; min-width: 0; }
  .host-panel:not([hidden]) { min-height: 4rem; }
  .host-empty { color: var(--muted); font-size: 0.85rem; margin: 0; }
  .host-panel > .live-cell > h3 { display: none; }
  .live-cell { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 0.75rem; min-width: 0; }
  .cell-result {
    margin-top: 0.65rem;
    border-left: 3px solid var(--border);
    padding: 0.45rem 0.7rem;
  }
  .cell-result-head, .failure-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .cell-result-head .cell-result-verdict, .failure-section-head h3 { margin: 0; }
  .copy-error { flex: none; padding: 0.2rem 0.45rem; font-size: 0.72rem; }
  .cell-result.status-passed { border-left-color: var(--pass); }
  .cell-result.status-failed { border-left-color: var(--fail); }
  .cell-result.status-skipped { border-left-color: var(--skip); }
  .cell-result-verdict { font-weight: 650; margin: 0 0 0.25rem; }
  .cell-result.status-passed .cell-result-verdict { color: var(--pass); }
  .cell-result.status-failed .cell-result-verdict { color: var(--fail); }
  .cell-result-metrics { color: var(--muted); font-size: 0.8rem; margin: 0 0 0.35rem; }
  .cell-result-failures, .cell-result-judges {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  .cell-result-judges { margin-top: 0.45rem; }
  .cell-result-failures li, .cell-result-judges li {
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .judge-pass { color: var(--pass); }
  .judge-fail { color: var(--fail); }
  .live-cell h3 { margin-bottom: 0.45rem; }
  .live-status {
    list-style: none;
    margin: 0 0 0.55rem;
    padding: 0;
    display: grid;
    gap: 0.2rem;
    max-height: 9rem;
    overflow: auto;
    font-size: 0.75rem;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .live-status li {
    border-left: 2px solid var(--border);
    padding: 0.12rem 0 0.12rem 0.5rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .run-banner { font-size: 0.85rem; color: var(--muted); }
  .run-progress {
    display: grid;
    gap: 0.55rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0.8rem 1rem;
    margin-bottom: 1.25rem;
  }
  .run-progress[hidden] { display: none; }
  .run-progress-head, .run-progress-counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem 1rem;
  }
  .run-progress-title { margin: 0; font-weight: 700; }
  .run-progress-counts { justify-content: flex-start; color: var(--muted); font-size: 0.8rem; }
  .run-progress-counts strong { color: var(--text); font-variant-numeric: tabular-nums; }
  .run-progress-counts .progress-passed strong { color: var(--pass); }
  .run-progress-counts .progress-failed strong { color: var(--fail); }
  .run-progress-counts .progress-skipped strong { color: var(--skip); }
  .run-progress-track {
    height: 0.7rem;
    overflow: hidden;
    border-radius: 999px;
    background: var(--panel-2);
    border: 1px solid var(--border);
  }
  .run-progress-fill {
    display: block;
    width: 0;
    height: 100%;
    background: var(--pass);
    transition: width 180ms ease-out;
  }
  .run-progress[data-has-failures="true"] .run-progress-fill {
    background: linear-gradient(90deg, var(--pass), var(--fail));
  }
  .compare-tab[data-status="running"] { color: var(--skip); }
  .compare-tab[data-status="passed"] { color: var(--pass); }
  .compare-tab[data-status="failed"] { color: var(--fail); }
  .compare-tab[data-status="skipped"] { color: var(--muted); }
  .compare-tabs .compare-arms,
  .compare-tabs .compare-arms[data-arm-count] { grid-template-columns: minmax(0, 1fr); }
  .compare-tabs .live-cell[hidden] { display: none; }
  .compare-tabs .live-cell > h3 { display: none; }
  .chat-running-row[hidden] { display: none; }
  .context-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
    display: block;
  }
  .context-why {
    color: var(--muted);
    font-size: 0.8rem;
    display: block;
    margin-top: 0.15rem;
  }
  .context-panel {
    margin: 0 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--skip) 10%, var(--panel-2));
    padding: 0.55rem 0.75rem;
  }
  .context-panel-summary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    cursor: pointer;
    font-weight: 700;
  }
  .context-panel-count { color: var(--muted); font-weight: 600; font-size: 0.82rem; }
  .context-flow { display: flex; align-items: center; gap: 0.35rem; margin: 0.55rem 0; flex-wrap: wrap; }
  .context-flow-node { border: 1px solid var(--border); border-radius: 999px; background: var(--panel); padding: 0.2rem 0.55rem; font-size: 0.78rem; font-weight: 650; }
  .context-flow-mode { border-color: var(--skip); }
  .context-flow-arrow { color: var(--muted); }
  .context-host-input { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 0.4rem 0.55rem; margin-top: 0.45rem; }
  .context-host-input summary { cursor: pointer; font-size: 0.82rem; font-weight: 700; }
  .context-panel-lede, .context-empty { color: var(--muted); font-size: 0.85rem; margin: 0.45rem 0 0; }
  .context-files { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.4rem; }
  .context-file {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    padding: 0.4rem 0.55rem;
  }
  .context-file[data-reason="contextSources"] { border-left: 3px solid var(--skip); }
  .context-file[data-reason="skills"] { border-left: 3px solid var(--tool); }
  .context-file[data-reason="profile"] { border-left: 3px solid var(--muted); }
  .context-file summary { cursor: pointer; }
  .context-body {
    margin: 0.45rem 0 0;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    font-size: 0.82rem;
    line-height: 1.45;
    max-height: 18rem;
    overflow: auto;
  }
  .chat-running {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0.2rem 0.1rem;
  }
  .chat-progress {
    display: inline-flex;
    gap: 0.18rem;
  }
  .chat-progress span {
    width: 0.32rem;
    height: 0.32rem;
    border-radius: 999px;
    background: var(--skip);
    animation: chat-progress 1s ease-in-out infinite;
  }
  .chat-progress span:nth-child(2) { animation-delay: 0.15s; }
  .chat-progress span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes chat-progress {
    0%, 80%, 100% { opacity: 0.2; }
    40% { opacity: 1; }
  }
  .bubble.is-streaming .bubble-text::after {
    content: "▍";
    margin-left: 0.12rem;
    color: var(--pass);
    animation: chat-caret 1s step-end infinite;
  }
  @keyframes chat-caret {
    50% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-progress span, .bubble.is-streaming .bubble-text::after { animation: none; }
  }
  .scenario-card {
    background: linear-gradient(135deg, color-mix(in oklch, var(--panel) 94%, white), var(--panel));
    padding: 1rem 1.05rem;
  }
  .scenario-detail { gap: 0.4rem; }
  .scenario-detail strong { font-size: 1.05rem; letter-spacing: -0.01em; }
  .scenario-toolbar { gap: 0.45rem 0.85rem; padding-top: 0.6rem; border-top: 1px solid var(--border); }
  .host-runs { display: flex; gap: 0.4rem; align-items: center; }
  .host-runs-label { color: var(--muted); font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .host-tablist { gap: 0.25rem; }
  .host-tab { gap: 0.28rem; padding: 0.25rem 0.45rem; font-size: 0.82rem; }
  body { background: oklch(0.155 0.015 250); }
  .viewer-shell { max-width: none; min-height: 100dvh; padding: 0; }
  .viewer-topbar {
    position: sticky; inset-block-start: 0; z-index: 10;
    display: grid; grid-template-columns: minmax(12rem, .7fr) minmax(18rem, 1.2fr) minmax(14rem, 1fr);
    align-items: center; gap: 1rem; min-height: 4.5rem;
    padding: .75rem clamp(1rem, 2.5vw, 2rem);
    background: color-mix(in oklch, var(--bg) 92%, transparent);
    border-block-end: 1px solid var(--border); backdrop-filter: blur(18px);
  }
  .viewer-identity { display: flex; align-items: baseline; gap: .65rem; min-width: 0; }
  .viewer-identity .brand { color: var(--pass); }
  .viewer-identity h1 { font-size: 1.05rem; white-space: nowrap; }
  .run-context { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .5rem; min-width: 0; }
  .run-history { width: 100%; min-width: 0; border-radius: 7px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); padding: .42rem .6rem; }
  .run-banner { margin: 0; overflow: hidden; color: var(--muted); font-size: .78rem; text-align: end; text-overflow: ellipsis; white-space: nowrap; }
  .viewer-command-row { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem 1rem; padding: .55rem clamp(1rem, 2.5vw, 2rem); background: var(--panel-2); border-block-end: 1px solid var(--border); }
  .viewer-command-row .toolbar-block { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .55rem; }
  .viewer-command-row .host-toggles { gap: .25rem .55rem; }
  .viewer-command-row .parallel-control { display: inline-flex; align-items: center; gap: .35rem; color: var(--muted); font-size: .78rem; white-space: nowrap; }
  .viewer-command-row .run-toggle { min-width: 5.75rem; margin-inline-start: auto; padding-block: .3rem; font-size: .78rem; }
  .run-progress { margin: 0; padding: .7rem clamp(1rem, 2.5vw, 2rem); border: 0; border-block-end: 1px solid var(--border); border-radius: 0; background: var(--bg); }
  .run-progress-track { height: .35rem; }
  .viewer-workspace { display: grid; grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr); min-height: calc(100dvh - 7.5rem); }
  .test-navigator { position: sticky; inset-block-start: 7.5rem; align-self: start; height: calc(100dvh - 7.5rem); overflow: auto; padding: 1.15rem .75rem 2rem; background: color-mix(in oklch, var(--panel-2) 72%, var(--bg)); border-inline-end: 1px solid var(--border); }
  .test-navigator-heading { display: flex; justify-content: space-between; align-items: end; padding-inline: .5rem; margin-block-end: 1rem; }
  .section-label, .scenario-path { margin: 0; color: var(--muted); font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
  .test-navigator-heading h2 { margin: .1rem 0 0; font-size: 1rem; }
  .test-picker, .test-picker-label { display: none; }
  .test-tree { display: grid; gap: 1.1rem; }
  .test-nav-suite { display: grid; gap: .35rem; }
  .test-nav-suite > header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding-inline: .45rem; }
  .test-nav-suite > header h2 { margin: 0; color: var(--muted); font-size: .72rem; letter-spacing: .05em; text-transform: uppercase; }
  .test-nav-suite > header p { display: none; }
  .test-nav-suite > header .run-suite { padding: .12rem .35rem; color: var(--muted); border: 0; background: transparent; font-size: .7rem; }
  .test-nav-items { display: grid; gap: .18rem; }
  .test-nav-item { display: grid; grid-template-columns: .6rem minmax(0, 1fr); align-items: start; gap: .55rem; width: 100%; padding: .5rem .55rem; border-color: transparent; background: transparent; text-align: start; }
  .test-nav-item:hover { background: color-mix(in oklch, var(--text) 5%, transparent); }
  .test-nav-item[aria-current="true"] { background: color-mix(in oklch, var(--pass) 9%, var(--panel)); border-color: color-mix(in oklch, var(--pass) 28%, var(--border)); }
  .test-nav-status { width: .48rem; height: .48rem; margin-block-start: .28rem; border: 1px solid var(--muted); border-radius: 50%; }
  .test-nav-item[data-status="running"] .test-nav-status { border-color: var(--skip); background: var(--skip); box-shadow: 0 0 0 3px color-mix(in oklch, var(--skip) 14%, transparent); }
  .test-nav-item[data-status="passed"] .test-nav-status { border-color: var(--pass); background: var(--pass); }
  .test-nav-item[data-status="failed"] .test-nav-status { border-color: var(--fail); background: var(--fail); }
  .test-nav-item[data-status="skipped"] .test-nav-status { border-color: var(--skip); }
  .test-nav-copy { display: grid; min-width: 0; }
  .test-nav-copy strong { overflow: hidden; font-size: .82rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .test-nav-copy small { overflow: hidden; color: var(--muted); font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }
  .test-stage { min-width: 0; padding: clamp(1rem, 3vw, 2.25rem); }
  .test-stage > .suite { display: block; margin: 0; }
  .test-stage > .suite > .suite-header { display: none; }
  .test-stage .scenario-list { display: contents; }
  .scenario-card, .scenario-card[data-selected="true"] { max-width: 76rem; margin-inline: auto; padding: 0; gap: 0; overflow: hidden; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 36px oklch(0 0 0 / .16); }
  .scenario-card[hidden] { display: none; }
  .scenario-focus-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: clamp(1rem, 2vw, 1.5rem); border-block-end: 1px solid var(--border); }
  .scenario-heading-copy { display: grid; gap: .3rem; min-width: 0; }
  .scenario-heading-copy h2 { margin: 0; font-size: clamp(1.25rem, 2.5vw, 1.75rem); letter-spacing: -.025em; }
  .scenario-heading-copy .suite-description { max-width: 62ch; color: var(--muted); font-size: .9rem; }
  .scenario-heading-copy .scenario-lede { max-width: 62ch; font-size: .9rem; }
  .focus-verdict { display: inline-flex; align-items: center; gap: .4rem; flex: none; padding: .28rem .55rem; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; font-size: .72rem; font-weight: 700; text-transform: uppercase; }
  .focus-verdict > span { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
  .focus-verdict[data-status="running"] { color: var(--skip); }
  .focus-verdict[data-status="passed"] { color: var(--pass); }
  .focus-verdict[data-status="failed"] { color: var(--fail); }
  .scenario-definition { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(15rem, .7fr); gap: .8rem; padding: clamp(1rem, 2vw, 1.5rem); background: color-mix(in oklch, var(--panel) 88%, var(--bg)); }
  .test-intent, .criteria-panel, .compare-definition, .comparison-criteria { min-width: 0; padding: .9rem; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; }
  .prompt-preview { margin: .45rem 0 0; color: var(--text); font-size: .94rem; line-height: 1.55; }
	.task-metadata { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .55rem; margin-block-start: .75rem; padding-block-start: .65rem; border-block-start: 1px solid var(--border); }
	.task-metadata + .task-metadata { margin-block-start: .55rem; padding-block-start: 0; border-block-start: 0; }
	.task-metadata .task-meta-label { color: var(--muted); font-size: .66rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
	.task-metadata p { margin: 0; color: var(--muted); font-size: .76rem; line-height: 1.6; }
	.task-metadata code { padding: .08rem .28rem; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; overflow-wrap: anywhere; }
  .criteria-panel > summary { display: flex; justify-content: space-between; gap: .5rem; cursor: pointer; font-size: .82rem; font-weight: 650; }
  .criteria-summary { color: var(--muted); font-size: .72rem; font-weight: 400; }
  .criterion-groups { display: grid; gap: .65rem; margin-block-start: .75rem; }
  .criterion-group { display: grid; gap: .35rem; padding-block-start: .6rem; border-block-start: 1px solid var(--border); }
  .criterion-group:first-child { padding-block-start: 0; border-block-start: 0; }
  .criterion-group h4 { margin: 0; color: var(--muted); font-size: .66rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .criterion-group p { margin: 0; color: var(--muted); font-size: .76rem; line-height: 1.4; }
  .criterion-list { display: grid; gap: .28rem; margin: 0; padding: 0; list-style: none; }
  .criterion-list li { color: var(--text); font-size: .78rem; line-height: 1.4; }
  .criterion-list code { padding: .08rem .28rem; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; overflow-wrap: anywhere; }
  .criteria-empty { margin: .7rem 0 0; color: var(--muted); font-size: .78rem; line-height: 1.45; }
	.compare-definition { grid-column: 1 / -1; }
  .comparison-intro { margin: .35rem 0 0; color: var(--muted); font-size: .78rem; }
  .compare-definition { padding: 0; background: transparent; border: 0; }
  .compare-definition-tabs { display: flex; flex-wrap: wrap; gap: .35rem; margin-block-start: .55rem; }
  .compare-definition-tab-input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
  .compare-definition-tab { padding: .35rem .65rem; color: var(--muted); background: var(--panel-2); border: 1px solid var(--border); border-radius: 7px; cursor: pointer; font-size: .78rem; }
  .compare-definition-tab-input:checked + .compare-definition-tab { color: var(--text); background: color-mix(in oklch, var(--pass) 12%, var(--panel-2)); border-color: color-mix(in oklch, var(--pass) 36%, var(--border)); }
  .compare-definition-tab-input:focus-visible + .compare-definition-tab { outline: 2px solid var(--pass); outline-offset: 2px; }
  .compare-definition-grid { display: grid; grid-template-columns: minmax(0, 1fr); margin-block-start: .55rem; }
  .compare-arm-definition { min-width: 0; overflow: hidden; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; }
  .compare-definition-tabbed .compare-arm-definition { display: none; }
  .compare-arm-header { display: grid; gap: .2rem; padding: .8rem .9rem; border-block-end: 1px solid var(--border); }
  .compare-arm-header h3 { margin: 0; font-size: .95rem; }
  .compare-arm-description { margin: 0; color: var(--muted); font-size: .76rem; line-height: 1.45; }
  .compare-arm-definition .test-intent, .compare-arm-definition .criteria-panel { border: 0; border-radius: 0; }
  .compare-arm-definition .test-intent { background: transparent; }
  .compare-arm-definition .criteria-panel { border-block-start: 1px solid var(--border); background: color-mix(in oklch, var(--panel-2) 82%, var(--bg)); }
  .scenario-toolbar { justify-content: space-between; gap: .75rem 1rem; padding: .8rem clamp(1rem, 2vw, 1.5rem); background: var(--panel); border-block: 1px solid var(--border); }
  .host-runs-label { font-size: .65rem; }
  .host-tab { padding: .3rem .5rem; background: transparent; }
  .host-tab[aria-selected="true"] { color: var(--text); background: color-mix(in oklch, var(--pass) 11%, var(--panel-2)); }
  .scenario-actions .run-toggle { min-width: 5.6rem; padding: .28rem .55rem; font-size: .78rem; }
  .scenario-live { padding: clamp(1rem, 2vw, 1.5rem); background: var(--bg); }
  .scenario-live .host-empty { padding: 2rem; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
  @container (max-width: 48rem) { .scenario-definition { grid-template-columns: minmax(0, 1fr); } .compare-definition { grid-column: auto; } }
  @media (max-width: 800px) {
    .viewer-topbar { position: static; grid-template-columns: minmax(0, 1fr); gap: .6rem; padding-block: .85rem; }
    .viewer-identity { justify-content: space-between; }
    .run-context { grid-template-columns: minmax(0, 1fr); gap: .25rem; }
    .run-banner { text-align: start; }
    .viewer-command-row { position: sticky; inset-block-start: 0; z-index: 9; }
    .viewer-workspace { display: block; min-height: 0; }
    .test-navigator { position: static; height: auto; padding: .75rem 1rem; border-inline-end: 0; border-block-end: 1px solid var(--border); }
    .test-navigator-heading, .test-tree { display: none; }
    .test-picker-label { display: block; margin-block-end: .25rem; color: var(--muted); font-size: .68rem; font-weight: 700; text-transform: uppercase; }
    .test-picker { display: block; width: 100%; padding: .5rem .6rem; border: 1px solid var(--border); border-radius: 7px; background: var(--panel); color: var(--text); }
    .test-stage { padding: .8rem; }
    .scenario-focus-header { align-items: center; }
    .scenario-definition { grid-template-columns: minmax(0, 1fr); }
    .compare-definition { grid-column: auto; }
    .scenario-toolbar { align-items: flex-start; }
    .host-runs { align-items: flex-start; flex-direction: column; }
  }
  @media (max-width: 480px) { .scenario-focus-header { display: grid; } .focus-verdict { justify-self: start; } .scenario-toolbar { display: grid; } .scenario-actions { width: 100%; } .scenario-actions .primary { flex: 1; } .viewer-command-row .run-toggle { width: 100%; margin-inline-start: 0; } }
`;
}

interface CriterionGroup {
	title: string;
	intro?: string;
	items: string[];
}

function criterionCode(value: string): string {
	return `<code>${escapeHtml(value)}</code>`;
}

interface ViewerCriteriaTarget {
	rubric: ScenarioRubric;
	contextSources?: string[];
	suppliedMcp?: Array<{ name: string; tools: string[] }>;
	suppliedSkills?: string[];
}

function renderAllowedCommands(target: ViewerCriteriaTarget): string {
	const commands = target.rubric.allowedCommands;
	if (commands === undefined) return "";
	const list = commands.length
		? commands.map(criterionCode).join('<span aria-hidden="true">, </span>')
		: '<span class="task-command-empty">None</span>';
	return `<div class="task-metadata task-allowed-commands"><span class="task-meta-label">Allowed commands</span><p>${list}</p></div>`;
}

function renderProvidedContext(target: ViewerCriteriaTarget): string {
	if (!target.contextSources?.length) return "";
	const sources = target.contextSources
		.map(criterionCode)
		.join('<span aria-hidden="true">, </span>');
	return `<div class="task-metadata task-provided-context"><span class="task-meta-label">Provided context</span><p>${sources}</p></div>`;
}

function renderSuppliedResources(target: ViewerCriteriaTarget, showEmpty = false): string {
	const servers = target.suppliedMcp ?? [];
	const tools = [...new Set(servers.flatMap((server) => server.tools))];
	const skills = target.suppliedSkills ?? [];
	const value = (items: string[]): string =>
		items.length
			? items.map(criterionCode).join('<span aria-hidden="true">, </span>')
			: '<span class="task-resource-empty">None</span>';
	if (!showEmpty && servers.length === 0 && skills.length === 0) return "";
	return `<div class="task-resources">
      <div class="task-metadata"><span class="task-meta-label">Supplied MCP servers</span><p>${value(servers.map((server) => server.name))}</p></div>
      <div class="task-metadata"><span class="task-meta-label">Supplied MCP tools</span><p>${value(tools)}</p></div>
      <div class="task-metadata"><span class="task-meta-label">Supplied skills</span><p>${value(skills)}</p></div>
    </div>`;
}

function renderPassCriteria(target: ViewerCriteriaTarget): { count: number; html: string } {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
	const reply: string[] = [];
	for (const text of rubric.must ?? []) {
		reply.push(`Final reply must include ${criterionCode(text)}.`);
	}
	for (const text of rubric.mustNot ?? []) {
		reply.push(`The run must not contain ${criterionCode(text)}.`);
	}
	if (reply.length) groups.push({ title: "Reply", items: reply });

	if (rubric.mustRun?.length || rubric.mustRunSuccessfully?.length) {
		groups.push({
			title: "Required commands",
			items: [
				...(rubric.mustRun ?? []).map(
					(command) => `Must run a command matching ${criterionCode(command)}.`,
				),
				...(rubric.mustRunSuccessfully ?? []).map(
					(command) => `Must run a command matching ${criterionCode(command)} successfully.`,
				),
			],
		});
	}
	const tools = [
		...(rubric.mustCallTool ?? []).map((tool) => `Must call ${criterionCode(tool)}.`),
		...(rubric.mustCallToolsInOrder ?? []).map(
			(tool, index) => `${index + 1}. Call ${criterionCode(tool)}.`,
		),
		...(rubric.mustNotCallTool ?? []).map((tool) => `Must not call ${criterionCode(tool)}.`),
	];
	if (tools.length) {
		groups.push({
			title: "Tools",
			intro: rubric.mustCallToolsInOrder?.length ? "Ordered tool calls are numbered." : undefined,
			items: tools,
		});
	}

	const files = [
		...(rubric.mustReadPath ?? []).map(
			(path) => `Must read a path matching ${criterionCode(path)}.`,
		),
		...(rubric.mustNotReadPath ?? []).map(
			(path) => `Must not read a path matching ${criterionCode(path)}.`,
		),
	];
	if (files.length) groups.push({ title: "Files", items: files });

	const skills = [
		...(rubric.mustInvokeSkill ?? []).map((skill) => `Must use ${criterionCode(skill)}.`),
		...(rubric.mustNotInvokeSkill ?? []).map((skill) => `Must not use ${criterionCode(skill)}.`),
	];
	if (skills.length) groups.push({ title: "Skills", items: skills });

	const routing = [
		...(rubric.handsOnRouting
			? ["Must announce hands-on routing before the first tool call."]
			: []),
		...(rubric.tier ? [`Must announce the ${criterionCode(rubric.tier)} tier.`] : []),
		...(rubric.reviewDepth
			? [`Must announce ${criterionCode(rubric.reviewDepth)} review depth.`]
			: []),
		...(rubric.routingBlock ? ["Must announce a routing block."] : []),
	];
	if (routing.length) groups.push({ title: "Routing", items: routing });

	if (rubric.judge?.length) {
		groups.push({
			title: "Judge",
			intro: "A judge evaluates these questions after the run.",
			items: rubric.judge.map((item) =>
				escapeHtml(typeof item === "string" ? item : item.question),
			),
		});
	}
	const count = groups.reduce((total, group) => total + Math.max(group.items.length, 1), 0);
	const html = groups
		.map(
			(group) =>
				`<section class="criterion-group"><h4>${escapeHtml(group.title)}</h4>${group.intro ? `<p>${escapeHtml(group.intro)}</p>` : ""}${group.items.length ? `<ul class="criterion-list">${group.items.map((item) => `<li>${item}</li>`).join("")}</ul>` : ""}</section>`,
		)
		.join("");
	return { count, html };
}

function armLabel(scenario: ViewerCatalogScenario, id: string): string {
	return scenario.compare?.find((arm) => arm.id === id)?.label ?? id;
}

function renderComparisonCriteria(scenario: ViewerCatalogScenario): {
	count: number;
	html: string;
} {
	const items = scenario.gates?.length
		? scenario.gates.map(
				(gate) => `${escapeHtml(describeCompareGate(gate, (id) => armLabel(scenario, id)))}.`,
			)
		: (scenario.compare ?? []).map(
				(arm) => `${escapeHtml(arm.label)} must pass all of its criteria.`,
			);
	const acceptableBehavior = scenario.judgeMetrics?.length
		? `<section class="criterion-group comparison-acceptable-behavior"><h4>Acceptable behavior</h4><p>The same questions are judged separately for every arm. The arm-result rules below decide which verdicts are required.</p><ul class="criterion-list">${scenario.judgeMetrics.map((metric) => `<li>${escapeHtml(metric.question)}</li>`).join("")}</ul></section>`
		: "";
	const sharedJudge = scenario.rubric.judge?.length
		? `<section class="criterion-group comparison-shared-judge"><h4>Comparison judge</h4><p>One judge sees all completed arms and evaluates the comparison as a whole.</p><ul class="criterion-list">${scenario.rubric.judge.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.question)}</li>`).join("")}</ul></section>`
		: "";
	return {
		count:
			items.length + (scenario.judgeMetrics?.length ?? 0) + (scenario.rubric.judge?.length ?? 0),
		html: `${acceptableBehavior}${sharedJudge}<section class="criterion-group"><h4>Arm results</h4><ul class="criterion-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul></section>`,
	};
}

function renderCompareArm(arm: NonNullable<ViewerCatalogScenario["compare"]>[number]): string {
	const criteria = renderPassCriteria(arm);
	return `<article class="compare-arm-definition" data-compare-arm-definition="${escapeHtml(arm.id)}">
      <header class="compare-arm-header">
        <p class="section-label">Arm</p>
        <h3>${escapeHtml(arm.label)}</h3>
        ${arm.description ? `<p class="compare-arm-description">${escapeHtml(arm.description)}</p>` : ""}
      </header>
      <section class="test-intent">
        <p class="section-label">Task</p>
        <p class="prompt-preview">${escapeHtml(arm.prompt)}</p>
        ${renderAllowedCommands(arm)}
        ${renderProvidedContext(arm)}
		${renderSuppliedResources(arm, true)}
      </section>
      <details class="criteria-panel" open>
        <summary><span>Pass criteria</span><span class="criteria-summary">${criteria.count ? `${criteria.count} ${criteria.count === 1 ? "check" : "checks"}` : "Completion only"}</span></summary>
        ${criteria.html ? `<div class="criterion-groups">${criteria.html}</div>` : '<p class="criteria-empty">This arm passes when it completes without a runner error.</p>'}
      </details>
    </article>`;
}

function comparisonDefinitionGroupId(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
): string {
	return `cd-${suite.name}-${scenario.name}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function renderCompareDefinition(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
): string {
	const arms = scenario.compare ?? [];
	const group = comparisonDefinitionGroupId(suite, scenario);
	const tabs = arms
		.map((arm, index) => {
			const id = `${group}-${arm.id}`;
			return `<input type="radio" class="compare-definition-tab-input" name="${escapeHtml(group)}" id="${escapeHtml(id)}"${index === 0 ? " checked" : ""}>
            <label class="compare-definition-tab" role="tab" for="${escapeHtml(id)}">${escapeHtml(arm.label)}</label>`;
		})
		.join("");
	const rules = arms
		.map(
			(arm) =>
				`.${group}:has(#${group}-${arm.id}:checked) [data-compare-arm-definition="${arm.id}"]{display:block}`,
		)
		.join("");
	return `<style>${rules}</style>
        <section class="compare-definition compare-definition-tabbed ${escapeHtml(group)}">
          <p class="section-label">Arms</p>
          <div class="compare-definition-tabs" role="tablist" aria-label="Comparison arm definitions">${tabs}</div>
          <div class="compare-definition-grid">${arms.map(renderCompareArm).join("")}</div>
        </section>`;
}

function defaultScenarioHost(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
	defaultSelectedHosts: string[],
): string {
	if (scenario.host && suite.hosts.includes(scenario.host)) {
		return scenario.host;
	}
	const configured = suite.hosts.find((host) => defaultSelectedHosts.includes(host));
	if (configured) {
		return configured;
	}
	return suite.hosts.length === 1 ? (suite.hosts[0] ?? "") : "";
}

function hostIsSkipped(scenario: ViewerCatalogScenario, host: string): boolean {
	return Boolean(scenario.skip || (scenario.host && scenario.host !== host));
}

function renderHostChrome(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
	selectedHost: string,
): string {
	if (suite.hosts.length <= 1) {
		const host = suite.hosts[0] ?? selectedHost;
		const skipped = hostIsSkipped(scenario, host);
		return `<div class="host-status" data-cell="${escapeHtml(`${suite.name}::${scenario.name}::${host}`)}">
        <span class="cell-status muted">${skipped ? "skip" : "idle"}</span>
      </div>`;
	}
	const tabs = suite.hosts
		.map((host) => {
			const skipped = hostIsSkipped(scenario, host);
			const selected = host === selectedHost;
			return `<button type="button" class="host-tab" role="tab" aria-label="${escapeHtml(host)}" data-cell="${escapeHtml(`${suite.name}::${scenario.name}::${host}`)}" data-host="${escapeHtml(host)}" aria-selected="${selected ? "true" : "false"}"${skipped ? " disabled" : ""}>${escapeHtml(host)} <span class="cell-status muted" aria-hidden="true">${skipped ? "skip" : "idle"}</span></button>`;
		})
		.join("");
	return `<div class="host-runs"><span class="host-runs-label">Run host</span><div class="host-tablist" role="tablist">${tabs}</div><span class="host-empty-selection" hidden>No selected host can run this test.</span></div>`;
}

function renderHostPanels(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
	selectedHost: string,
	results: ViewerRenderedResult[],
	canRun: boolean,
): string {
	return suite.hosts
		.map((host) => {
			const selected = host === selectedHost;
			const result = results.find(
				(item) =>
					item.suite === suite.name && item.scenario === scenario.name && item.host === host,
			);
			const hostHeading = !canRun && suite.hosts.length > 1 ? `<h3>${escapeHtml(host)}</h3>` : "";
			return `<div class="host-panel" data-host-panel="${escapeHtml(host)}" role="tabpanel"${canRun && !selected ? " hidden" : ""}>${hostHeading}${result?.html ?? '<p class="host-empty">No run yet.</p>'}</div>`;
		})
		.join("");
}

function renderScenarioCard(
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
	results: ViewerRenderedResult[],
	canRun: boolean,
	defaultSelectedHosts: string[],
	selected: boolean,
): string {
	const selectedHost = defaultScenarioHost(suite, scenario, defaultSelectedHosts);
	const runDisabled = !selectedHost || hostIsSkipped(scenario, selectedHost);
	const hasResult = results.some(
		(item) => item.suite === suite.name && item.scenario === scenario.name,
	);
	const key = escapeHtml(`${suite.name}::${scenario.name}`);
	const criteria = renderPassCriteria(scenario);
	const comparisonCriteria = scenario.compare ? renderComparisonCriteria(scenario) : undefined;
	const definition = comparisonCriteria
		? `<section class="test-intent comparison-task">
		  <p class="section-label">Comparison task</p>
		  <p class="prompt-preview">${escapeHtml(scenario.prompt)}</p>
		</section>
		<section class="comparison-criteria">
          <p class="section-label">Comparison pass criteria</p>
          <p class="comparison-intro">Each arm runs independently. These checks decide whether the comparison passes.</p>
          <div class="criterion-groups">${comparisonCriteria.html}</div>
        </section>
        ${renderCompareDefinition(suite, scenario)}`
		: `<section class="test-intent">
          <p class="section-label">Task</p>
          <p class="prompt-preview">${escapeHtml(scenario.prompt)}</p>
          ${renderAllowedCommands(scenario)}
		  ${renderProvidedContext(scenario)}
		  ${renderSuppliedResources(scenario)}
        </section>
        <details class="criteria-panel" open>
		  <summary><span>Pass criteria</span><span class="criteria-summary">${criteria.count ? `${criteria.count} ${criteria.count === 1 ? "check" : "checks"}` : "Completion only"}</span></summary>
		  ${criteria.html ? `<div class="criterion-groups">${criteria.html}</div>` : '<p class="criteria-empty">The scenario passes when it completes without a runner error.</p>'}
        </details>`;
	return `<article class="scenario-card" data-scenario-card="${key}" data-selected="${selected ? "true" : "false"}"${selected ? "" : " hidden"}>
    <header class="scenario-focus-header">
      <div class="scenario-heading-copy">
        <p class="scenario-path">${escapeHtml(suite.name)} <span aria-hidden="true">/</span> test</p>
        ${suite.description ? `<p class="suite-description">${escapeHtml(suite.description)}</p>` : ""}
        <h2>${escapeHtml(scenario.name)}</h2>
        ${scenario.description ? `<p class="scenario-lede">${escapeHtml(scenario.description)}</p>` : ""}
      </div>
      <span class="focus-verdict" data-focus-verdict="${key}" data-status="idle"><span aria-hidden="true"></span>Not run</span>
    </header>
    <div class="scenario-definition">
      ${definition}
    </div>
    <div class="scenario-toolbar">
      ${renderHostChrome(suite, scenario, selectedHost)}
      <div class="scenario-actions">
		<button class="primary run-toggle run-cell" data-start-label="Start test" data-suite="${escapeHtml(suite.name)}" data-scenario="${escapeHtml(scenario.name)}" data-host="${escapeHtml(selectedHost)}"${scenario.skip || !canRun ? ' disabled data-fixed-disabled="1"' : runDisabled ? " disabled" : ""}>Start test</button>
      </div>
    </div>
    <div class="scenario-live"${hasResult ? "" : " hidden"} data-live-row="${key}" data-live-slot="${key}">
      <div class="host-panels">${renderHostPanels(suite, scenario, selectedHost, results, canRun)}</div>
    </div>
  </article>`;
}

function renderSuiteSection(
	suite: ViewerCatalogSuite,
	results: ViewerRenderedResult[],
	canRun: boolean,
	defaultSelectedHosts: string[],
	firstScenarioKey: string,
): string {
	const cards = suite.scenarios
		.map((scenario) =>
			renderScenarioCard(
				suite,
				scenario,
				results,
				canRun,
				defaultSelectedHosts,
				`${suite.name}::${scenario.name}` === firstScenarioKey,
			),
		)
		.join("");
	return `
<section class="suite" data-suite="${escapeHtml(suite.name)}">
  <div class="scenario-list">${cards}</div>
</section>`;
}

function renderTestNavigator(
	catalog: ViewerCatalog,
	firstScenarioKey: string,
	canRun: boolean,
): string {
	const groups = catalog.suites
		.map((suite) => {
			const tests = suite.scenarios
				.map((scenario) => {
					const key = `${suite.name}::${scenario.name}`;
					const selected = key === firstScenarioKey;
					const status = scenario.skip ? "skipped" : "idle";
					return `<button type="button" class="test-nav-item" data-select-scenario="${escapeHtml(key)}" data-status="${status}" aria-current="${selected ? "true" : "false"}">
            <span class="test-nav-status" aria-hidden="true"></span>
            <span class="test-nav-copy"><strong>${escapeHtml(scenario.name)}</strong>${scenario.description ? `<small>${escapeHtml(scenario.description)}</small>` : ""}</span>
          </button>`;
				})
				.join("");
			return `<section class="test-nav-suite" data-nav-suite="${escapeHtml(suite.name)}">
        <header><div><h2>${escapeHtml(suite.name)}</h2>${suite.description ? `<p>${escapeHtml(suite.description)}</p>` : ""}</div><button class="run-toggle run-suite" data-start-label="Start suite" data-suite="${escapeHtml(suite.name)}"${canRun ? "" : ' disabled data-fixed-disabled="1"'}>Start suite</button></header>
        <div class="test-nav-items">${tests}</div>
      </section>`;
		})
		.join("");
	const options = catalog.suites
		.flatMap((suite) =>
			suite.scenarios.map((scenario) => {
				const key = `${suite.name}::${scenario.name}`;
				return `<option value="${escapeHtml(key)}"${key === firstScenarioKey ? " selected" : ""}>${escapeHtml(suite.name)} / ${escapeHtml(scenario.name)}</option>`;
			}),
		)
		.join("");
	return `<aside class="test-navigator" aria-label="Tests">
    <div class="test-navigator-heading"><div><p class="section-label">Test catalog</p><h2>${catalog.suites.reduce((sum, suite) => sum + suite.scenarios.length, 0)} tests</h2></div></div>
    <label class="test-picker-label" for="test-picker">Selected test</label>
    <select class="test-picker" id="test-picker">${options}</select>
    <nav class="test-tree" aria-label="Test catalog">${groups}</nav>
  </aside>`;
}

function clientScript(): string {
	return `
(function () {
  var bootstrap = JSON.parse(document.getElementById("bootstrap-data").textContent);
  var catalog = bootstrap.catalog;
  var source = null;
  var runId = null;
	var selectedRunId = bootstrap.selectedRunId || null;
  var cancelRequested = false;
	var activeRunRequest = null;
	var viewedRunHosts = null;
  var progress = { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0, seen: {}, experiments: {} };
	var selectedScenarioKey = document.querySelector("[data-scenario-card][data-selected='true']")?.getAttribute("data-scenario-card") || null;

	function selectScenario(key) {
		if (!key) return;
		selectedScenarioKey = key;
		document.querySelectorAll("[data-scenario-card]").forEach(function (card) {
			var selected = card.getAttribute("data-scenario-card") === key;
			card.dataset.selected = selected ? "true" : "false";
			card.hidden = !selected;
		});
		document.querySelectorAll("[data-select-scenario]").forEach(function (item) {
			item.setAttribute("aria-current", item.getAttribute("data-select-scenario") === key ? "true" : "false");
		});
		var picker = document.getElementById("test-picker");
		if (picker) picker.value = key;
	}

	function syncScenarioStatus(suite, scenario) {
		var key = suite + "::" + scenario;
		var card = document.querySelector('[data-scenario-card="' + key + '"]');
		if (!card) return;
		var labels = Array.prototype.map.call(card.querySelectorAll(".cell-status"), function (node) { return node.textContent; });
		var status = labels.indexOf("failed") !== -1 ? "failed"
			: labels.some(function (label) { return label === "running" || label === "starting" || label === "cancelling"; }) ? "running"
			: labels.indexOf("passed") !== -1 ? "passed"
			: labels.length > 0 && labels.every(function (label) { return label === "skip" || label === "skipped" || label === "cancelled"; }) ? "skipped"
			: "idle";
		document.querySelectorAll('[data-select-scenario="' + key + '"]').forEach(function (item) { item.dataset.status = status; });
		var verdict = document.querySelector('[data-focus-verdict="' + key + '"]');
		if (verdict) {
			verdict.dataset.status = status;
			verdict.lastChild.textContent = status === "idle" ? "Not run" : status.charAt(0).toUpperCase() + status.slice(1);
		}
	}

  function selectedHosts() {
    return Array.prototype.map.call(document.querySelectorAll("[data-host-toggle]:checked"), function (box) {
      return box.value;
    });
  }

	function updateHostSelectionControls() {
		var hasSelectedHost = selectedHosts().length > 0;
		syncScenarioHostChoices();
		document.querySelectorAll(".run-toggle").forEach(function (button) {
			if (button.dataset.runAction !== "stop") {
				var hasTarget = button.classList.contains("run-cell")
					? !!button.getAttribute("data-host")
					: hasSelectedHost;
				button.disabled = !hasTarget || button.dataset.fixedDisabled === "1";
			}
		});
	}

	function syncScenarioHostChoices() {
		var hosts = Array.isArray(viewedRunHosts) ? viewedRunHosts : selectedHosts();
		var isFiltered = hosts.length > 0;
		document.querySelectorAll("[data-scenario-card]").forEach(function (card) {
			var tabs = Array.prototype.slice.call(card.querySelectorAll(".host-tab"));
			if (tabs.length === 0) return;
			tabs.forEach(function (tab) {
				var eligible = !tab.disabled && (!isFiltered || hosts.indexOf(tab.getAttribute("data-host")) !== -1);
				tab.hidden = isFiltered && !eligible;
			});
			var current = tabs.find(function (tab) { return tab.getAttribute("aria-selected") === "true" && !tab.hidden && !tab.disabled; });
			var available = tabs.find(function (tab) { return !tab.hidden && !tab.disabled; });
			if (!current && isFiltered && available) {
				selectHostTab(card, available.getAttribute("data-host"));
				current = available;
			}
			var empty = card.querySelector(".host-empty-selection");
			if (empty) empty.hidden = !!available;
			if (!available) {
				tabs.forEach(function (tab) { tab.setAttribute("aria-selected", "false"); });
				card.querySelectorAll("[data-host-panel]").forEach(function (panel) { panel.hidden = true; });
				var run = card.querySelector("button.run-cell");
				if (run) {
					run.setAttribute("data-host", "");
					run.disabled = true;
				}
			}
		});
	}

	function scopedRunControl(request) {
		if (!request) return null;
		if (request.scenario) {
			return document.querySelector('.run-cell[data-suite="' + request.suite + '"][data-scenario="' + request.scenario + '"]');
		}
		if (request.suite) return document.querySelector('.run-suite[data-suite="' + request.suite + '"]');
		return null;
	}

	function setRunControls(status, request) {
		activeRunRequest = status === "idle" ? null : request || activeRunRequest;
		document.querySelectorAll(".run-toggle").forEach(function (button) {
			button.textContent = button.dataset.startLabel || "Start run";
			button.dataset.runAction = "start";
			button.classList.remove("danger");
		});
		updateHostSelectionControls();
		if (status === "idle") return;
		document.querySelectorAll(".run-toggle").forEach(function (button) { button.disabled = true; });
		var controls = [document.getElementById("run-selection"), scopedRunControl(activeRunRequest)];
		controls.forEach(function (button) {
			if (!button) return;
			button.dataset.runAction = "stop";
			button.textContent = status === "cancelling"
				? "Stopping…"
				: button.id === "run-selection" ? "Stop run" : (button.classList.contains("run-suite") ? "Stop suite" : "Stop test");
			button.classList.add("danger");
			button.disabled = status === "cancelling";
		});
	}

  function parallelHosts() {
    return document.getElementById("parallel-hosts").checked;
  }

  function setRunBanner(text) {
    document.getElementById("run-banner").textContent = text;
  }

  function runnableTargets(body) {
    var requestedHosts = Array.isArray(body.hosts) ? body.hosts : catalog.defaultSelectedHosts;
    var total = 0;
    catalog.suites.forEach(function (suite) {
      if (body.suite && suite.name !== body.suite) {
        return;
      }
      suite.scenarios.forEach(function (scenario) {
        if (body.scenario && scenario.name !== body.scenario) {
          return;
        }
        if (scenario.skip) {
          return;
        }
        requestedHosts.forEach(function (host) {
          if (suite.hosts.indexOf(host) === -1 || (scenario.host && scenario.host !== host)) {
            return;
          }
          total += 1;
        });
      });
    });
    return total;
  }

  function renderProgress() {
    var box = document.getElementById("run-progress");
    var total = Math.max(progress.total, progress.completed);
    var remaining = Math.max(0, total - progress.completed);
    box.hidden = total === 0;
    box.setAttribute("data-has-failures", progress.failed > 0 ? "true" : "false");
    var testLabel = total === 1 ? "test" : "tests";
    box.querySelector(".run-progress-title").textContent = progress.completed + " of " + total + " " + testLabel + " finished";
    box.querySelector(".progress-passed strong").textContent = String(progress.passed);
    box.querySelector(".progress-failed strong").textContent = String(progress.failed);
    box.querySelector(".progress-skipped strong").textContent = String(progress.skipped);
    box.querySelector(".progress-remaining strong").textContent = String(remaining);
    var percent = total > 0 ? Math.round((progress.completed / total) * 100) : 0;
    var fill = box.querySelector(".run-progress-fill");
    fill.style.width = percent + "%";
    fill.parentNode.setAttribute("aria-valuenow", String(progress.completed));
    fill.parentNode.setAttribute("aria-valuemax", String(total));
  }

  function resetProgress(body) {
    progress = { total: runnableTargets(body), completed: 0, passed: 0, failed: 0, skipped: 0, seen: {}, experiments: {} };
    renderProgress();
  }

  function recordProgress(event) {
    var key = cellKey(event);
    if (progress.seen[key]) {
      return;
    }
    progress.seen[key] = true;
    var experiment = experimentState(event);
    experiment.cells[event.arm || "_"] = event;
    var scenario = findScenario(event.suite, event.scenario);
    var expectedArms = scenario && scenario.compare && scenario.compare.length ? scenario.compare.length : 1;
    if (Object.keys(experiment.cells).length < expectedArms || experiment.counted) {
      renderProgress();
      return;
    }
    experiment.counted = true;
    progress.completed += 1;
    var outcome = experimentOutcome(scenario, experiment.cells);
    if (outcome === "skipped") progress.skipped += 1;
    else if (outcome === "passed") progress.passed += 1;
    else progress.failed += 1;
    renderProgress();
  }

  function finishProgress(event) {
    // The stream reports one cell per comparison arm. Progress is based on
    // the completed scenario/host experiment, so expected failed controls do
    // not turn a passing comparison into a red suite result.
    progress.total = Math.max(progress.total, progress.completed);
    renderProgress();
  }

  function experimentKey(event) {
    return [event.suite, event.scenario, event.host].join("::");
  }

  function experimentState(event) {
    var key = experimentKey(event);
    if (!progress.experiments[key]) {
      progress.experiments[key] = { cells: {}, counted: false };
    }
    return progress.experiments[key];
  }

  function experimentOutcome(scenario, cells) {
    var events = Object.keys(cells).map(function (id) { return cells[id]; });
    if (events.some(function (event) { return event.skipped; })) return "skipped";
    var byArm = {};
    events.forEach(function (event) { byArm[event.arm || "_"] = event; });
    if (!scenario || !scenario.compare || !scenario.compare.length) {
      return events.every(function (event) { return event.passed; }) ? "passed" : "failed";
    }
    var gates = scenario.gates || [];
    var behaviorOk = events.every(function (event) {
      return event.passed || (event.failures || []).every(function (failure) {
        return gates.some(function (gate) {
          return gate.metric === "outcome" && gate.arm === event.arm && gate.operator === "equal" && gate.value === "fail";
        });
      });
    });
    var gatesOk = gates.every(function (gate) {
      if (gate.metric === "outcome" && gate.arm) {
        var event = byArm[gate.arm];
        if (!event) return false;
        var actual = event.passed ? "pass" : "fail";
        return gate.operator === "equal" ? actual === gate.value : false;
      }
      if (["turns", "tokens", "tools", "durationMs"].indexOf(gate.metric) !== -1 && gate.winner && gate.loser) {
        var winner = byArm[gate.winner];
        var loser = byArm[gate.loser];
        var field = gate.metric === "durationMs" ? "durationMs" : gate.metric;
        var winnerValue = winner && winner.metrics && winner.metrics[field];
        var loserValue = loser && loser.metrics && loser.metrics[field];
        return typeof winnerValue === "number" && typeof loserValue === "number" && winnerValue < loserValue;
      }
      return true;
    });
    return behaviorOk && gatesOk ? "passed" : "failed";
  }

  function cellKey(event) {
    return [event.suite, event.scenario, event.host, event.arm || "_"].join("::");
  }

  function paneId(event) {
    return "live-" + cellKey(event).replace(/[^a-z0-9]+/gi, "-");
  }

  function compareWrapId(event) {
    return ("live-wrap-" + event.suite + "-" + event.scenario + "-" + event.host).replace(/[^a-z0-9]+/gi, "-");
  }

  function selectCompareTab(wrap, armId) {
    wrap.querySelectorAll(".compare-tab").forEach(function (tab) {
      var on = tab.getAttribute("data-arm") === armId;
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    wrap.querySelectorAll(".live-cell").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-arm") !== armId;
    });
  }

  function scenarioCard(event) {
    return document.querySelector('[data-scenario-card="' + event.suite + "::" + event.scenario + '"]');
  }

  function selectHostTab(card, host) {
    if (!card || !host) {
      return;
    }
    card.querySelectorAll(".host-tab").forEach(function (tab) {
      var on = tab.getAttribute("data-host") === host;
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    card.querySelectorAll("[data-host-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-host-panel") !== host;
    });
    var run = card.querySelector("button.run-cell");
    if (run) {
      run.setAttribute("data-host", host);
      var tab = card.querySelector('.host-tab[data-host="' + host + '"]');
      if (tab) {
        run.disabled = tab.disabled;
      }
    }
  }

  function revealLive(event) {
    var card = scenarioCard(event);
    if (!card) {
      return;
    }
    var live = card.querySelector(".scenario-live");
    if (live) {
      live.hidden = false;
    }
    if (card.dataset.userPickedHost === "1") {
      return;
    }
    if (card.dataset.followHost && card.dataset.followHost !== event.host) {
      return;
    }
    card.dataset.followHost = event.host;
    selectHostTab(card, event.host);
  }

  function hostPanel(event) {
    var card = scenarioCard(event);
    return card ? card.querySelector('[data-host-panel="' + event.host + '"]') : null;
  }

  function markArmTab(wrap, armId, status) {
    var tab = wrap.querySelector('.compare-tab[data-arm="' + armId + '"]');
    if (tab) {
      tab.setAttribute("data-status", status);
    }
  }

  function createLiveArticle(event, title) {
    var article = document.createElement("article");
    article.className = "live-cell";
    article.id = paneId(event);
    article.dataset.chatKey = cellKey(event);
    article.innerHTML = "<h3></h3><ol class=\\"live-status\\"></ol><div class=\\"chat\\"></div>";
    article.querySelector("h3").textContent = title;
    return article;
  }

  var openChats = {};

  function resetArticle(article) {
    if (!article) {
      return;
    }
    var status = article.querySelector(".live-status");
    if (status) {
      status.replaceChildren();
    }
    var chat = article.querySelector(".chat");
    if (chat) {
      chat.replaceChildren();
    }
    var result = article.querySelector(".cell-result");
    if (result) {
      result.remove();
    }
    var contextPanel = article.querySelector(".context-panel");
    if (contextPanel) {
      contextPanel.remove();
    }
    var panel = article.closest("[data-host-panel]");
    var empty = panel ? panel.querySelector(".host-empty") : null;
    if (empty) {
      empty.hidden = false;
    }
  }

  function chatIsOpen(event) {
    return !!openChats[cellKey(event)];
  }

  function startChat(event) {
    openChats[cellKey(event)] = true;
    delete assistantBodies[cellKey(event)];
    delete finishedMetrics[cellKey(event)];
    ensurePane(event);
    resetArticle(document.getElementById(paneId(event)));
    var panel = hostPanel(event);
    var empty = panel ? panel.querySelector(".host-empty") : null;
    if (empty) {
      empty.hidden = true;
    }
  }

  function markRunningIdle() {
    document.querySelectorAll("[data-cell]").forEach(function (node) {
      var status = node.querySelector(".cell-status");
      if (!status) {
        return;
      }
      var label = status.textContent;
      if (label !== "running" && label !== "starting") {
        return;
      }
      status.textContent = "idle";
      status.className = "cell-status muted";
      if (node.classList.contains("host-tab")) {
        node.setAttribute("data-status", "idle");
      }
    });
    document.querySelectorAll(".compare-tab[data-status='running']").forEach(function (tab) {
      tab.setAttribute("data-status", "idle");
    });
  }

  function closeAllChats() {
    Object.keys(openChats).forEach(function (key) {
      resetArticle(document.getElementById("live-" + key.replace(/[^a-z0-9]+/gi, "-")));
    });
    openChats = {};
    assistantBodies = {};
    hideAllRunning();
    markRunningIdle();
  }

	function resetViewerCards() {
		closeAllChats();
		document.querySelectorAll("[data-host-panel]").forEach(function (panel) {
			panel.innerHTML = '<p class="host-empty">No run yet.</p>';
		});
		document.querySelectorAll(".scenario-live").forEach(function (live) { live.hidden = true; });
		document.querySelectorAll(".cell-status").forEach(function (status) {
			if (status.textContent !== "skip") {
				status.textContent = "idle";
				status.className = "cell-status muted";
			}
		});
		catalog.suites.forEach(function (suite) {
			suite.scenarios.forEach(function (scenario) { syncScenarioStatus(suite.name, scenario.name); });
		});
	}

	function runLabel(run) {
		var scope = run.request && (run.request.scenario || run.request.suite) || "all tests";
		var time = new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		return time + " · " + scope + " · " + run.status;
	}

	function renderRunHistory(runs) {
		bootstrap.runs = runs;
		var select = document.getElementById("run-history");
		select.replaceChildren();
		var idle = document.createElement("option");
		idle.value = "";
		idle.textContent = "Tests · no run selected";
		select.appendChild(idle);
		runs.forEach(function (run) {
			var option = document.createElement("option");
			option.value = run.id;
			option.textContent = runLabel(run);
			select.appendChild(option);
		});
		select.value = selectedRunId || "";
	}

	function completedRunBanner(run) {
		if (run.status === "cancelled") return "Run cancelled.";
		if (run.status !== "completed") return "Run " + run.id + " · " + run.status + ".";
		var counts = (run.reports || []).reduce(function (total, report) {
			total.passed += report.passed || 0;
			total.failed += report.failed || 0;
			total.skipped += report.skipped || 0;
			return total;
		}, { passed: 0, failed: 0, skipped: 0 });
		return "Run finished. " + counts.passed + " passed. " + counts.failed + " failed. " + counts.skipped + " skipped.";
	}

	async function refreshRunHistory() {
		if (!bootstrap.capabilities.canRun) return;
		var response = await fetch("/api/runs");
		if (!response.ok) return;
		renderRunHistory(await response.json());
	}

	async function selectRun(id) {
		selectedRunId = id || null;
		viewedRunHosts = null;
		if (source) { source.close(); source = null; }
		runId = null;
		cancelRequested = false;
		resetViewerCards();
		if (!selectedRunId) {
			setRunBanner("Choose tests to run.");
			setRunControls("idle");
			renderRunHistory(bootstrap.runs || []);
			return;
		}
		var response = await fetch("/api/runs/" + selectedRunId);
		if (!response.ok) return;
		var payload = await response.json();
		viewedRunHosts = Array.isArray(payload.run.request && payload.run.request.hosts) ? payload.run.request.hosts : null;
		syncScenarioHostChoices();
		(payload.fragments || []).forEach(function (fragment) {
			var card = document.querySelector('[data-scenario-card="' + fragment.suite + "::" + fragment.scenario + '"]');
			var panel = card && card.querySelector('[data-host-panel="' + fragment.host + '"]');
			if (!card || !panel) return;
			panel.innerHTML = fragment.html;
			installCopyErrorButtons(panel);
			var live = card.querySelector(".scenario-live");
			if (live) live.hidden = false;
			markCell(fragment, fragment.skipped ? "skipped" : fragment.passed ? "passed" : "failed", fragment.skipped ? "status-skipped" : fragment.passed ? "status-passed" : "status-failed");
		});
		var preferred = (payload.fragments || []).find(function (fragment) { return !fragment.skipped && !fragment.passed; }) || (payload.fragments || [])[0];
		if (preferred) selectScenario(preferred.suite + "::" + preferred.scenario, false);
		if (payload.run.status === "cancelled") {
			markRunTargets(payload.run.request || {}, "cancelled", "status-skipped");
		}
		setRunBanner(completedRunBanner(payload.run));
		renderRunHistory((bootstrap.runs || []).map(function (item) { return item.id === payload.run.id ? payload.run : item; }));
		if (payload.run.status === "running" || payload.run.status === "cancelling") {
			runId = payload.run.id;
			setRunControls(payload.run.status === "cancelling" ? "cancelling" : "running", payload.run.request);
			source = new EventSource("/api/runs/" + runId + "/events");
			source.onmessage = function (message) { handleEvent(JSON.parse(message.data)); };
		} else {
			setRunControls("idle");
		}
	}

	function requestRunStop() {
		if (!runId || cancelRequested) return;
		cancelRequested = true;
		setRunBanner("Stopping the run.");
		setRunControls("cancelling", activeRunRequest);
		cancelOpenChats();
		fetch("/api/runs/" + runId + "/cancel", { method: "POST" }).then(function (response) {
			if (!response.ok && cancelRequested) {
				setRunBanner("Stop failed.");
				cancelRequested = false;
				setRunControls("running", activeRunRequest);
			}
		}).catch(function () {
			if (cancelRequested) {
				setRunBanner("Stop failed.");
				cancelRequested = false;
				setRunControls("running", activeRunRequest);
			}
		});
	}

  function showCancelledNote(article, text) {
    if (!article) {
      return;
    }
    var existing = article.querySelector(".cell-result");
    if (existing) {
      existing.remove();
    }
    var box = document.createElement("div");
    box.className = "cell-result status-skipped";
    var verdict = document.createElement("p");
    verdict.className = "cell-result-verdict";
    verdict.textContent = text;
    box.appendChild(verdict);
    article.appendChild(box);
    var panel = article.closest("[data-host-panel]");
    var empty = panel ? panel.querySelector(".host-empty") : null;
    if (empty) {
      empty.hidden = true;
    }
  }

  function cancelOpenChats() {
    document.querySelectorAll(".cell-status").forEach(function (status) {
      if (status.textContent !== "running" && status.textContent !== "starting") {
        return;
      }
      status.textContent = "cancelling";
      status.className = "cell-status status-skipped";
      var tab = status.closest(".host-tab");
      if (tab) {
        tab.setAttribute("data-status", "cancelling");
      }
    });
    document.querySelectorAll(".compare-tab[data-status='running']").forEach(function (tab) {
      tab.setAttribute("data-status", "cancelling");
    });
    hideAllRunning();
    document.querySelectorAll("[data-cell]").forEach(function (node) {
      var status = node.querySelector(".cell-status");
      if (!status || status.textContent !== "cancelling") {
        return;
      }
      var card = node.closest("[data-scenario-card]");
      if (!card) {
        return;
      }
      var live = card.querySelector(".scenario-live");
      if (live) {
        live.hidden = false;
      }
      var host = node.getAttribute("data-host") || (node.getAttribute("data-cell") || "").split("::")[2];
      var panel = card.querySelector('[data-host-panel="' + host + '"]');
      if (!panel) {
        return;
      }
      var articles = panel.querySelectorAll("article.live-cell");
      if (articles.length === 0) {
        showCancelledNote(panel, "Cancelled. Stopping the host agent.");
        return;
      }
      articles.forEach(function (article) {
        var key = article.dataset.chatKey;
        resetArticle(article);
        showCancelledNote(article, "Cancelled. Stopping the host agent.");
        if (key) {
          delete openChats[key];
          delete assistantBodies[key];
        }
      });
    });
  }

  function markCancelledCells() {
    document.querySelectorAll(".cell-status").forEach(function (status) {
      if (status.textContent === "cancelling") {
        status.textContent = "cancelled";
        status.className = "cell-status status-skipped";
        var tab = status.closest(".host-tab");
        if (tab) {
          tab.setAttribute("data-status", "cancelled");
        }
      }
    });
    document.querySelectorAll(".compare-tab[data-status='cancelling']").forEach(function (tab) {
      tab.setAttribute("data-status", "cancelled");
    });
    document.querySelectorAll(".cell-result-verdict").forEach(function (node) {
      if (node.textContent === "Cancelled. Stopping the host agent.") {
        node.textContent = "Cancelled.";
      }
    });
  }

  function sealAllChats() {
    openChats = {};
  }

  function addArmTab(wrap, list, article, armId, label, selected) {
    article.setAttribute("role", "tabpanel");
    article.setAttribute("data-arm", armId);
    article.hidden = !selected;
    var tab = document.createElement("button");
    tab.type = "button";
    tab.className = "compare-tab";
    tab.setAttribute("role", "tab");
    tab.setAttribute("data-arm", armId);
    tab.setAttribute("aria-controls", article.id);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.textContent = label;
    tab.addEventListener("click", function () {
      wrap.dataset.userPicked = "1";
      selectCompareTab(wrap, armId);
    });
    list.appendChild(tab);
  }

  function ensureCompareWrap(event, scenario, slot) {
    var wrapId = compareWrapId(event);
    var wrap = document.getElementById(wrapId);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "compare-layout compare-tabs";
      wrap.id = wrapId;
      var list = document.createElement("div");
      list.className = "compare-tablist";
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-label", "Comparison arms");
      wrap.appendChild(list);
      var arms = document.createElement("div");
      arms.className = "compare-arms";
      if (scenario && scenario.compare) {
        arms.setAttribute("data-arm-count", String(scenario.compare.length));
      }
      wrap.appendChild(arms);
      if (scenario && scenario.compare) {
        scenario.compare.forEach(function (arm, index) {
          var article = createLiveArticle({
            suite: event.suite,
            scenario: event.scenario,
            host: event.host,
            arm: arm.id,
          }, arm.label);
          addArmTab(wrap, list, article, arm.id, arm.label, index === 0);
          arms.appendChild(article);
        });
      }
    }
    if (!wrap.parentNode) {
      slot.appendChild(wrap);
    }
    return wrap;
  }

  function ensurePane(event) {
    var existing = document.getElementById(paneId(event));
    if (existing) {
      revealLive(event);
      return existing.querySelector(".chat");
    }
    var slot = hostPanel(event);
    if (!slot) {
      return null;
    }
    revealLive(event);
    var empty = slot.querySelector(".host-empty");
    if (empty) {
      empty.hidden = true;
    }
    var leftover = slot.querySelector(":scope > .cell-result");
    if (leftover) {
      leftover.remove();
    }
    var scenario = findScenario(event.suite, event.scenario);
    if (event.arm) {
      var wrap = ensureCompareWrap(event, scenario, slot);
      existing = document.getElementById(paneId(event));
      if (existing) {
        if (wrap.dataset.userPicked !== "1") {
          selectCompareTab(wrap, event.arm);
        }
        return existing.querySelector(".chat");
      }
      return null;
    }
    var article = createLiveArticle(event, event.host);
    slot.appendChild(article);
    return article.querySelector(".chat");
  }

  function appendStatus(event, text) {
    var article = document.getElementById(paneId(event));
    var list = article ? article.querySelector(".live-status") : null;
    if (!list) {
      ensurePane(event);
      article = document.getElementById(paneId(event));
      list = article ? article.querySelector(".live-status") : null;
    }
    if (!list) {
      return;
    }
    var item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
    list.scrollTop = list.scrollHeight;
  }

  function appendBubble(chat, role, text) {
    var row = document.createElement("div");
    row.className = "chat-row " + (role === "user" ? "side-right" : "side-left");
    var bubble = document.createElement("div");
    bubble.className = "bubble role-" + role;
    var label = document.createElement("div");
    label.className = "bubble-label";
    label.textContent = role;
    var body = document.createElement("div");
    body.className = "bubble-text";
    body.textContent = text;
    bubble.appendChild(label);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chat.appendChild(row);
    return body;
  }

  function runningRow(article) {
    return article.querySelector(".chat-running-row");
  }

  function showRunning(event) {
    var article = document.getElementById(paneId(event));
    if (!article) {
      ensurePane(event);
      article = document.getElementById(paneId(event));
    }
    if (!article) {
      return;
    }
    var chat = article.querySelector(".chat");
    if (!chat) {
      return;
    }
    var row = runningRow(article);
    if (!row) {
      row = document.createElement("div");
      row.className = "chat-row side-left chat-running-row";
      row.innerHTML = '<div class="chat-running" aria-live="polite">Running<span class="chat-progress" aria-hidden="true"><span></span><span></span><span></span></span></div>';
      chat.appendChild(row);
    }
    row.hidden = false;
    chat.appendChild(row);
  }

  function hideRunning(event) {
    var article = document.getElementById(paneId(event));
    var row = article ? runningRow(article) : null;
    if (row) {
      row.remove();
    }
  }

  function hideAllRunning() {
    document.querySelectorAll(".chat-running-row").forEach(function (row) {
      row.remove();
    });
    document.querySelectorAll(".bubble.is-streaming").forEach(function (bubble) {
      bubble.classList.remove("is-streaming");
    });
  }

  function setStreaming(event, on) {
    var body = assistantBodies[cellKey(event)];
    var bubble = body ? body.parentNode : null;
    if (bubble) {
      if (on) {
        bubble.classList.add("is-streaming");
      } else {
        bubble.classList.remove("is-streaming");
      }
    }
  }

  function appendContextPanel(article, mode, files, hostInput) {
    if (!article) {
      return;
    }
    var existing = article.querySelector(".context-panel");
    if (existing) {
      existing.remove();
    }
    var list = files || [];
    var panel = document.createElement("details");
    panel.className = "context-panel";
    panel.open = true;
    panel.setAttribute("data-context-mode", mode || "harness-preamble");
    panel.setAttribute("data-file-count", String(list.length));
    var summary = document.createElement("summary");
    summary.className = "context-panel-summary";
    var title = document.createElement("span");
    title.className = "context-panel-title";
    title.textContent = "Context delivery";
    var count = document.createElement("span");
    count.className = "context-panel-count";
    count.textContent = mode === "host-native"
      ? "Host-native"
      : "Harness preamble · " + (list.length === 1 ? "1 file" : list.length + " files");
    summary.appendChild(title);
    summary.appendChild(count);
    panel.appendChild(summary);

    var flow = document.createElement("div");
    flow.className = "context-flow";
    flow.setAttribute("aria-label", "Scenario prompt delivery path");
    ["Scenario", "→", mode === "host-native" ? "Host discovery" : "Harness preamble", "→", "Host"].forEach(function (label, index) {
      var item = document.createElement("span");
      item.className = index === 1 || index === 3
        ? "context-flow-arrow"
        : "context-flow-node" + (index === 2 ? " context-flow-mode" : "");
      item.textContent = label;
      flow.appendChild(item);
    });
    panel.appendChild(flow);

    if (typeof hostInput === "string") {
      var input = document.createElement("details");
      input.className = "context-host-input";
      input.open = true;
      var inputSummary = document.createElement("summary");
      inputSummary.textContent = "Exact submitted user input";
      var inputBody = document.createElement("pre");
      inputBody.className = "context-body";
      inputBody.textContent = hostInput;
      input.appendChild(inputSummary);
      input.appendChild(inputBody);
      panel.appendChild(input);
    }

    if (mode === "host-native") {
      var nativeLede = document.createElement("p");
      nativeLede.className = "context-panel-lede";
      nativeLede.textContent = "No harness preamble. Workspace files remain on disk for the host to discover.";
      panel.appendChild(nativeLede);
      var nativeUnknown = document.createElement("p");
      nativeUnknown.className = "context-empty";
      nativeUnknown.textContent = "Host-owned system instructions and native discovery are not exposed as one inspectable payload. agent-test does not claim which workspace instructions or skills the host loaded.";
      panel.appendChild(nativeUnknown);
    } else if (list.length === 0) {
      var empty = document.createElement("p");
      empty.className = "context-empty";
      empty.textContent = "No preamble files. The agent received the prompt only.";
      panel.appendChild(empty);
    } else {
      var lede = document.createElement("p");
      lede.className = "context-panel-lede";
      lede.textContent = "These files were in the host preamble for this run.";
      panel.appendChild(lede);
      var ol = document.createElement("ol");
      ol.className = "context-files";
      list.forEach(function (file) {
        var item = document.createElement("li");
        var details = document.createElement("details");
        details.className = "context-file";
        details.open = list.length === 1;
        details.setAttribute("data-reason", file.reason || "profile");
        details.setAttribute("data-path", file.path || "context");
        var fileSummary = document.createElement("summary");
        var path = document.createElement("span");
        path.className = "context-path";
        path.textContent = file.path || "context";
        var why = document.createElement("span");
        why.className = "context-why";
        why.textContent = file.why || "The runner loaded this file into the host preamble.";
        fileSummary.appendChild(path);
        fileSummary.appendChild(why);
        var body = document.createElement("pre");
        body.className = "context-body";
        body.textContent = file.text || "";
        details.appendChild(fileSummary);
        details.appendChild(body);
        item.appendChild(details);
        ol.appendChild(item);
      });
      panel.appendChild(ol);
    }
    var chat = article.querySelector(".chat");
    if (chat) {
      article.insertBefore(panel, chat);
    } else {
      article.appendChild(panel);
    }
  }

  function appendContextFiles(chat, mode, files, hostInput) {
		appendContextPanel(chat ? chat.closest("article.live-cell") : null, mode, files, hostInput);
  }

  function displayToolPath(path) {
    var stripped = String(path).replace(/^file:\\/\\//, "").replace(/\\/+$/, "");
    var workspace = stripped.match(/\\/agent-harness-seal-[^/]+(?:\\/(.*))?$/);
    if (workspace) {
      return workspace[1] ? workspace[1] : ".";
    }
    var sealed = stripped.match(/\\/(?:\\.agents|\\.claude|\\.codex|AGENTS\\.md|CLAUDE\\.md)(?:\\/|$)/);
    if (sealed && sealed.index !== undefined) {
      return stripped.slice(sealed.index + 1);
    }
    var parts = stripped.split("/").filter(Boolean);
    if (parts.length > 3) {
      return ".../" + parts.slice(-3).join("/");
    }
    return stripped;
  }

  function formatArgValue(key, value) {
    var pathKeys = { path: 1, file_path: 1, filePath: 1, target_file: 1, uri: 1, cwd: 1 };
    if (typeof value === "string" && (pathKeys[key] || value.indexOf("/") === 0 || value.indexOf("file://") === 0)) {
      return { text: displayToolPath(value), title: value };
    }
    var raw = typeof value === "string" ? value : JSON.stringify(value);
    var oneLine = raw.replace(/\\n/g, " ↵ ");
    return { text: oneLine.length > 140 ? oneLine.slice(0, 140) + "…" : oneLine };
  }

  function appendTool(chat, name, args) {
    var row = document.createElement("div");
    row.className = "chat-row side-left";
    var card = document.createElement("div");
    card.className = "tool-card";
    var head = document.createElement("div");
    head.className = "tool-card-head";
    var toolName = document.createElement("span");
    toolName.className = "tool-name";
    toolName.textContent = name;
    head.appendChild(toolName);
    card.appendChild(head);
    if (args) {
      var box = document.createElement("div");
      box.className = "tool-args";
      Object.keys(args).forEach(function (key) {
        var line = document.createElement("div");
        line.className = "tool-arg";
        var keyEl = document.createElement("span");
        keyEl.className = "tool-arg-key";
        keyEl.textContent = key;
        var value = document.createElement("code");
        var formatted = formatArgValue(key, args[key]);
        value.textContent = formatted.text;
        if (formatted.title && formatted.title !== formatted.text) {
          value.title = formatted.title;
        }
        line.appendChild(keyEl);
        line.appendChild(value);
        box.appendChild(line);
      });
      card.appendChild(box);
    }
    row.appendChild(card);
    chat.appendChild(row);
  }

  var assistantBodies = {};
  var finishedMetrics = {};

  function findScenario(suiteName, scenarioName) {
    for (var i = 0; i < catalog.suites.length; i++) {
      if (catalog.suites[i].name !== suiteName) {
        continue;
      }
      var scenarios = catalog.suites[i].scenarios;
      for (var j = 0; j < scenarios.length; j++) {
        if (scenarios[j].name === scenarioName) {
          return scenarios[j];
        }
      }
    }
    return null;
  }

  function joinLabels(labels) {
    if (labels.length <= 1) {
      return labels[0] || "";
    }
    if (labels.length === 2) {
      return labels[0] + " and " + labels[1];
    }
    return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
  }

  function summarizeMetric(arms, id, label) {
    var values = arms.map(function (arm) { return arm[id]; });
    var numeric = values.filter(function (value) { return typeof value === "number"; });
    if (numeric.length < 2) {
      return { line: label + ": n/a." };
    }
    var lowest = Math.min.apply(null, numeric);
    var winners = arms.filter(function (arm) { return arm[id] === lowest; });
    var shown = values.map(function (value) { return typeof value === "number" ? String(value) : "n/a"; }).join(" vs ");
    if (winners.length > 1) {
      return {
        line: arms.length === 2
          ? label + ": tie (" + shown + ")."
          : label + ": lowest is a tie between " + joinLabels(winners.map(function (arm) { return arm.label; })) + " (" + shown + ").",
      };
    }
    var winner = winners[0];
    if (!winner) {
      return { line: label + ": n/a." };
    }
    if (arms.length === 2) {
      return { line: label + ": " + winner.label + " wins (" + shown + ")." };
    }
    return { line: label + ": lowest is " + winner.label + " (" + shown + ")." };
  }

  function summarizeGates(arms, gates) {
    var byId = {};
    arms.forEach(function (arm) { byId[arm.id] = arm; });
    return (gates || []).map(function (gate) {
      var field = gate.metric === "durationMs" ? "durationMs" : gate.metric;
      var winner = byId[gate.winner];
      var loser = byId[gate.loser];
      if (!winner || !loser || ["turns", "tokens", "tools", "durationMs"].indexOf(field) === -1) {
        return { passed: true, line: gate.metric + ": scored in the final result." };
      }
      var winnerValue = winner[field];
      var loserValue = loser[field];
      if (typeof winnerValue !== "number" || typeof loserValue !== "number") {
        return { passed: false, line: gate.metric + ": one arm did not report a value. Fail." };
      }
      var passed = winnerValue < loserValue;
      return { passed: passed, line: winner.label + " must use fewer " + gate.metric + " than " + loser.label + " (" + winnerValue + " vs " + loserValue + "). " + (passed ? "Pass." : "Fail.") };
    });
  }

  function renderCompareWinners(event) {
    var scenario = findScenario(event.suite, event.scenario);
    if (!scenario || !scenario.compare || !scenario.compare.length) {
      return;
    }
    var wrap = document.getElementById(compareWrapId(event));
    if (!wrap) {
      return;
    }
    var rows = [];
    for (var i = 0; i < scenario.compare.length; i++) {
      var arm = scenario.compare[i];
      var metrics = finishedMetrics[[event.suite, event.scenario, event.host, arm.id].join("::")];
      if (!metrics) {
        return;
      }
      rows.push({
        id: arm.id,
        label: arm.label,
        turns: metrics.turns,
        tokens: metrics.tokens,
        tools: metrics.tools,
		durationMs: metrics.durationMs,
		passed: metrics.passed,
      });
    }
    var metricLines = [
      summarizeMetric(rows, "turns", "Turns"),
      summarizeMetric(rows, "tokens", "Tokens"),
      summarizeMetric(rows, "tools", "Tools"),
    ];
    var gateLines = summarizeGates(rows, scenario.gates);
    var existing = wrap.querySelector(".compare-winners");
    if (existing) {
      existing.remove();
    }
    var section = document.createElement("section");
    section.className = "compare-winners";
    var heading = document.createElement("h3");
    heading.textContent = "Winners";
    var list = document.createElement("ul");
    metricLines.forEach(function (metric) {
      var item = document.createElement("li");
      item.textContent = metric.line;
      list.appendChild(item);
    });
    gateLines.forEach(function (gate) {
      var item = document.createElement("li");
      item.className = gate.passed ? "compare-winner-pass" : "compare-winner-fail";
      item.textContent = gate.line;
      list.appendChild(item);
    });
    section.appendChild(heading);
    section.appendChild(list);
    wrap.appendChild(section);
  }

  function markCell(event, label, statusClass) {
    var selector = '[data-cell="' + event.suite + "::" + event.scenario + "::" + event.host + '"]';
    document.querySelectorAll(selector).forEach(function (node) {
      var status = node.querySelector(".cell-status");
      if (status) {
        status.textContent = label;
        status.className = "cell-status " + statusClass;
      }
      if (node.classList.contains("host-tab")) {
        node.setAttribute("data-status", label);
      }
    });
		syncScenarioStatus(event.suite, event.scenario);
  }

  function metricPart(count, one, many) {
    if (typeof count !== "number") {
      return "";
    }
    return count + " " + (count === 1 ? one : many);
  }

  function formatMetrics(metrics) {
    if (!metrics) {
      return "";
    }
    return [metricPart(metrics.turns, "turn", "turns"), metricPart(metrics.tokens, "token", "tokens"), metricPart(metrics.tools, "tool", "tools")]
      .filter(Boolean)
      .join(" · ");
  }

  function failureText(container) {
    var messages = Array.prototype.map.call(
      container.querySelectorAll(".failure-message, .cell-result-failures li"),
      function (node) { return node.textContent.trim(); }
    ).filter(Boolean);
    var evidence = Array.prototype.map.call(
      container.querySelectorAll(".failure-evidence"),
      function (node) { return node.textContent.trim(); }
    ).filter(Boolean);
    return messages.concat(evidence).join("\\n\\n");
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      var copied = document.execCommand("copy");
      input.remove();
      if (copied) resolve();
      else reject(new Error("Clipboard copy failed"));
    });
  }

  function copyErrorButton(container) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-error";
    button.textContent = "Copy error";
    button.addEventListener("click", function () {
      var text = failureText(container);
      copyText(text).then(function () {
        button.textContent = "Copied";
        window.setTimeout(function () { button.textContent = "Copy error"; }, 1500);
      }).catch(function () {
        button.textContent = "Copy failed";
        window.setTimeout(function () { button.textContent = "Copy error"; }, 1500);
      });
    });
    return button;
  }

  function installCopyErrorButtons(root) {
    root.querySelectorAll(".cell-result.status-failed").forEach(function (box) {
      if (box.querySelector(".copy-error") || !box.querySelector(".cell-result-failures")) return;
      var verdict = box.querySelector(".cell-result-verdict");
      if (!verdict) return;
      var head = document.createElement("div");
      head.className = "cell-result-head";
      box.insertBefore(head, verdict);
      head.appendChild(verdict);
      head.appendChild(copyErrorButton(box));
    });
    root.querySelectorAll("details.scenario.status-failed .diagnostics > section").forEach(function (section) {
      if (section.querySelector(".copy-error") || !section.querySelector(".failures")) return;
      var heading = section.querySelector("h3");
      if (!heading || heading.textContent.trim() !== "What went wrong") return;
      var head = document.createElement("div");
      head.className = "failure-section-head";
      section.insertBefore(head, heading);
      head.appendChild(heading);
      head.appendChild(copyErrorButton(section));
    });
  }

  function clearCellResult(event) {
    var article = document.getElementById(paneId(event));
    var existing = article ? article.querySelector(".cell-result") : null;
    if (existing) {
      existing.remove();
    }
  }

  function renderCellResult(event) {
    ensurePane(event);
    var article = document.getElementById(paneId(event));
    if (!article) {
      return;
    }
    var existing = article.querySelector(".cell-result");
    if (existing) {
      existing.remove();
    }
    var skipped = !!event.skipped;
    var passed = !!event.passed && !skipped;
    var box = document.createElement("div");
    box.className = "cell-result " + (skipped ? "status-skipped" : passed ? "status-passed" : "status-failed");
    var verdict = document.createElement("p");
    verdict.className = "cell-result-verdict";
    verdict.textContent = skipped ? "Skipped." : passed ? "Passed." : "Failed.";
    box.appendChild(verdict);
    var metrics = formatMetrics(event.metrics);
    if (metrics) {
      var line = document.createElement("p");
      line.className = "cell-result-metrics";
      line.textContent = metrics;
      box.appendChild(line);
    }
    if (!skipped && !passed) {
      var list = document.createElement("ul");
      list.className = "cell-result-failures";
      var failures = event.failures || [];
      if (failures.length === 0) {
        var item = document.createElement("li");
        item.textContent = "The run failed. The host did not report a reason.";
        list.appendChild(item);
      } else {
        failures.forEach(function (failure) {
          var item = document.createElement("li");
          item.textContent = failure.message || failure.matcher || "The run failed.";
          list.appendChild(item);
        });
      }
      box.appendChild(list);
    }
    article.appendChild(box);
    installCopyErrorButtons(article);
  }

  function appendJudgeVerdicts(event) {
    ensurePane(event);
    var article = document.getElementById(paneId(event));
    if (!article) {
      return;
    }
    var box = article.querySelector(".cell-result");
    if (!box) {
      box = document.createElement("div");
      box.className = "cell-result";
      article.appendChild(box);
    }
    var existing = box.querySelector(".cell-result-judges");
    if (existing) {
      existing.remove();
    }
    var list = document.createElement("ul");
    list.className = "cell-result-judges";
    (event.verdicts || []).forEach(function (verdict) {
      var item = document.createElement("li");
      item.className = verdict.pass ? "judge-pass" : "judge-fail";
      var text = (verdict.pass ? "Pass. " : "Fail. ") + (verdict.question || "");
      if (verdict.rationale) {
        text += " " + verdict.rationale;
      }
      item.textContent = text;
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  function handleEvent(event) {
    if (event.type === "run_started") {
      if (cancelRequested) {
        return;
      }
      setRunBanner("Run " + event.runId + " started.");
      setRunControls("running", activeRunRequest);
      return;
    }
    if (event.type === "run_finished") {
	  var wasCancelled = cancelRequested;
      finishProgress(event);
      hideAllRunning();
      sealAllChats();
      if (cancelRequested) {
        markCancelledCells();
        setRunBanner("Run cancelled.");
      } else {
        setRunBanner(
          "Run finished. " + progress.passed + " passed. " + progress.failed + " failed. " + progress.skipped + " skipped."
        );
      }
      setRunControls("idle");
      cancelRequested = false;
      runId = null;
      if (source) {
        source.close();
        source = null;
      }
	  void refreshRunHistory().then(function () {
		if (!wasCancelled) return selectRun(event.runId);
	  });
      return;
    }
    if (cancelRequested) {
      return;
    }
    if (event.type === "error") {
      setRunBanner(event.message);
      if (event.suite && chatIsOpen(event)) {
        appendStatus(event, event.message);
        var errorChat = ensurePane(event);
        if (errorChat) {
          appendBubble(errorChat, "system", event.message);
        }
      }
      return;
    }
	if (event.type === "scenario_result") {
		fetch("/api/runs/" + (runId || selectedRunId)).then(function (response) {
			return response.ok ? response.json() : null;
		}).then(function (payload) {
			if (!payload || selectedRunId !== payload.run.id) return;
			var fragment = (payload.fragments || []).find(function (item) {
				return item.suite === event.suite && item.scenario === event.scenario && item.host === event.host;
			});
			if (!fragment) return;
			var card = scenarioCard(event);
			var panel = card && card.querySelector('[data-host-panel="' + event.host + '"]');
			if (panel) panel.innerHTML = fragment.html;
			if (panel) installCopyErrorButtons(panel);
		}).catch(function () {});
		return;
	}
    if (event.type === "cell_started") {
      markCell(event, "running", "status-skipped");
      startChat(event);
      if (event.arm) {
        var startedWrap = document.getElementById(compareWrapId(event));
        if (startedWrap) {
          markArmTab(startedWrap, event.arm, "running");
          if (startedWrap.classList.contains("compare-tabs") && startedWrap.dataset.userPicked !== "1") {
            selectCompareTab(startedWrap, event.arm);
          }
        }
      }
      return;
    }
    if (event.type === "status") {
      if (!chatIsOpen(event)) {
        return;
      }
      appendStatus(event, event.text);
      return;
    }
    if (event.type === "context") {
      if (!chatIsOpen(event)) {
        return;
      }
      var contextChat = ensurePane(event);
      if (contextChat) {
        appendContextFiles(contextChat, event.mode, event.files, event.hostInput);
      }
      return;
    }
    if (event.type === "prompt") {
      if (!chatIsOpen(event)) {
        return;
      }
      var promptChat = ensurePane(event);
      if (promptChat) {
        appendBubble(promptChat, "user", event.text);
        showRunning(event);
      }
      return;
    }
    if (event.type === "text") {
      if (!chatIsOpen(event)) {
        return;
      }
      var key = cellKey(event);
      var chat = ensurePane(event);
      if (!chat) {
        return;
      }
      hideRunning(event);
      if (!assistantBodies[key]) {
        assistantBodies[key] = appendBubble(chat, "assistant", event.text);
      } else {
        assistantBodies[key].textContent = event.text;
      }
      setStreaming(event, true);
      return;
    }
    if (event.type === "tool") {
      if (!chatIsOpen(event)) {
        return;
      }
      var toolChat = ensurePane(event);
      if (!toolChat) {
        return;
      }
      setStreaming(event, false);
      assistantBodies[cellKey(event)] = null;
      hideRunning(event);
      appendTool(toolChat, event.name, event.args);
      showRunning(event);
      return;
    }
    if (event.type === "cell_finished") {
      recordProgress(event);
      if (!chatIsOpen(event)) {
        return;
      }
      hideRunning(event);
      setStreaming(event, false);
      markCell(event, event.skipped ? "skipped" : event.passed ? "passed" : "failed", event.skipped ? "status-skipped" : event.passed ? "status-passed" : "status-failed");
	  finishedMetrics[cellKey(event)] = Object.assign({}, event.metrics || {}, {
		durationMs: event.durationMs,
		passed: event.passed,
	  });
      renderCellResult(event);
      if (event.arm) {
        var finishedWrap = document.getElementById(compareWrapId(event));
        if (finishedWrap) {
          markArmTab(
            finishedWrap,
            event.arm,
            event.skipped ? "skipped" : event.passed ? "passed" : "failed"
          );
        }
        renderCompareWinners(event);
      }
      return;
    }
    if (event.type === "judge") {
      if (!chatIsOpen(event)) {
        return;
      }
      appendJudgeVerdicts(event);
    }
  }

  function markRunTargets(body, label, statusClass) {
    var hosts = Array.isArray(body.hosts) ? body.hosts : catalog.defaultSelectedHosts;
    catalog.suites.forEach(function (suite) {
      if (body.suite && suite.name !== body.suite) {
        return;
      }
      suite.scenarios.forEach(function (scenario) {
        if (body.scenario && scenario.name !== body.scenario) {
          return;
        }
        if (scenario.skip) {
          return;
        }
        hosts.forEach(function (host) {
          if (scenario.host && scenario.host !== host) {
            return;
          }
          markCell({ suite: suite.name, scenario: scenario.name, host: host }, label, statusClass);
        });
      });
    });
  }

  async function startRun(body) {
	if (!bootstrap.capabilities.canRun) return;
	if (Array.isArray(body.hosts) && body.hosts.length === 0) {
		setRunBanner("Select at least one host.");
		return;
	}
    if (runId) {
      setRunBanner(
        cancelRequested
          ? "Cancelling the run. Wait for it to stop."
          : "A run is already in progress. Cancel it first."
      );
      return;
    }
	resetViewerCards();
	activeRunRequest = body;
	viewedRunHosts = Array.isArray(body.hosts) ? body.hosts : null;
	syncScenarioHostChoices();
	setRunControls("running", body);
    resetProgress(body);
    markRunTargets(body, "starting", "status-skipped");
    var firstCard = document.querySelector(
      body.suite && body.scenario
        ? '[data-scenario-card="' + body.suite + "::" + body.scenario + '"]'
        : body.suite
          ? '[data-suite="' + body.suite + '"] [data-scenario-card]'
          : "[data-scenario-card]"
    );
    document.querySelectorAll("[data-scenario-card]").forEach(function (card) {
      if (body.suite && card.getAttribute("data-scenario-card").indexOf(body.suite + "::") !== 0) {
        return;
      }
      if (body.scenario && card.getAttribute("data-scenario-card") !== body.suite + "::" + body.scenario) {
        return;
      }
      delete card.dataset.followHost;
    });
    if (firstCard) {
		selectScenario(firstCard.getAttribute("data-scenario-card"), false);
      var live = firstCard.querySelector(".scenario-live");
      if (live) {
        live.hidden = false;
      }
      if (body.hosts && body.hosts.length === 1 && firstCard.dataset.userPickedHost !== "1") {
        firstCard.dataset.followHost = body.hosts[0];
        selectHostTab(firstCard, body.hosts[0]);
      }
      if (live) {
        live.scrollIntoView({ block: "nearest" });
      }
    }
    try {
      var response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      var payload = await response.json();
      if (!response.ok) {
        setRunBanner(payload.error || "Run failed to start.");
        progress = { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0, seen: {} };
        renderProgress();
        markRunTargets(body, "idle", "muted");
		setRunControls("idle");
        return;
      }
      runId = payload.runId;
		selectedRunId = runId;
		await refreshRunHistory();
      cancelRequested = false;
      setRunBanner("Run " + runId + " started.");
		setRunControls("running", body);
      if (source) {
        source.close();
      }
      source = new EventSource("/api/runs/" + runId + "/events");
      source.onmessage = function (message) {
        handleEvent(JSON.parse(message.data));
      };
      source.onerror = function () {
        source.close();
        if (!runId) {
          return;
        }
        setRunBanner("Live event stream dropped.");
      };
    } catch (error) {
      setRunBanner(error instanceof Error ? error.message : String(error));
      markRunTargets(body, "idle", "muted");
	  setRunControls("idle");
    }
  }

  document.getElementById("run-selection").addEventListener("click", function (event) {
	if (event.currentTarget.dataset.runAction === "stop") return requestRunStop();
    startRun({ hosts: selectedHosts(), parallelHosts: parallelHosts() });
  });
	document.querySelectorAll("[data-host-toggle]").forEach(function (toggle) {
		toggle.addEventListener("change", updateHostSelectionControls);
	});
	document.getElementById("run-history").addEventListener("change", function (event) {
		void selectRun(event.target.value);
	});
  document.body.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) {
      return;
    }
		if (button.classList.contains("test-nav-item")) {
			selectScenario(button.getAttribute("data-select-scenario"), false);
			return;
		}
    if (button.classList.contains("host-tab")) {
      var card = button.closest("[data-scenario-card]");
      if (card) {
        card.dataset.userPickedHost = "1";
        selectHostTab(card, button.getAttribute("data-host"));
      }
    }
    if (button.classList.contains("run-cell")) {
	  if (button.dataset.runAction === "stop") return requestRunStop();
      startRun({
        suite: button.getAttribute("data-suite"),
        scenario: button.getAttribute("data-scenario"),
        hosts: [button.getAttribute("data-host")],
        parallelHosts: false,
      });
    }
    if (button.classList.contains("run-suite")) {
	  if (button.dataset.runAction === "stop") return requestRunStop();
      startRun({
        suite: button.getAttribute("data-suite"),
        hosts: selectedHosts(),
        parallelHosts: parallelHosts(),
      });
    }
  });
	document.getElementById("test-picker")?.addEventListener("change", function (event) {
		selectScenario(event.target.value, false);
	});

	renderRunHistory(bootstrap.runs || []);
	installCopyErrorButtons(document);
	selectScenario(selectedScenarioKey, false);
	updateHostSelectionControls();
	if (selectedRunId && bootstrap.capabilities.canRun) void selectRun(selectedRunId);
	if (bootstrap.capabilities.canRun) setInterval(function () { void refreshRunHistory(); }, 1000);
})();
`;
}

function staticNavigationScript(): string {
	return `
(function () {
  function selectScenario(key) {
    document.querySelectorAll("[data-scenario-card]").forEach(function (card) {
      var selected = card.getAttribute("data-scenario-card") === key;
      card.dataset.selected = selected ? "true" : "false";
      card.hidden = !selected;
    });
    document.querySelectorAll("[data-select-scenario]").forEach(function (item) {
      item.setAttribute("aria-current", item.getAttribute("data-select-scenario") === key ? "true" : "false");
    });
    var picker = document.getElementById("test-picker");
    if (picker) picker.value = key;
  }
  document.body.addEventListener("click", function (event) {
    var item = event.target.closest("[data-select-scenario]");
    if (item) selectScenario(item.getAttribute("data-select-scenario"));
  });
  document.getElementById("test-picker")?.addEventListener("change", function (event) {
    selectScenario(event.target.value);
  });
})();
`;
}

export function renderViewerPage(
	input: ViewerCatalog | ViewerBootstrap,
	options: ViewerPageRenderOptions = {},
): string {
	const bootstrap: ViewerBootstrap =
		"catalog" in input ? input : { catalog: input, runs: [], capabilities: { canRun: true } };
	const catalog = bootstrap.catalog;
	const canRun = bootstrap.capabilities.canRun;
	const firstScenarioKey = catalog.suites[0]?.scenarios[0]
		? `${catalog.suites[0].name}::${catalog.suites[0].scenarios[0].name}`
		: "";
	const hostToggles = Array.from(new Set(catalog.suites.flatMap((suite) => suite.hosts)))
		.map((host) => {
			const checked = catalog.defaultSelectedHosts.includes(host) ? " checked" : "";
			return `<label><input type="checkbox" data-host-toggle value="${escapeHtml(host)}"${checked}>${escapeHtml(host)}</label>`;
		})
		.join("");
	const suites = catalog.suites
		.map((suite) =>
			renderSuiteSection(
				suite,
				options.results ?? [],
				canRun,
				catalog.defaultSelectedHosts,
				firstScenarioKey,
			),
		)
		.join("\n");
	const navigator = renderTestNavigator(catalog, firstScenarioKey, canRun);
	const historyOptions = [
		`<option value="">Tests · no run selected</option>`,
		...bootstrap.runs.map((run) => {
			const selected = run.id === bootstrap.selectedRunId ? " selected" : "";
			return `<option value="${escapeHtml(run.id)}"${selected}>${escapeHtml(run.id)} · ${escapeHtml(run.status)}</option>`;
		}),
	].join("");
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>agent-test ${canRun ? "viewer" : "report"}</title>
  <style>
${options.baseCss ?? ""}
${viewerCss()}
  </style>
</head>
<body>
  <main class="viewer-shell">
    <header class="viewer-topbar">
      <div class="viewer-identity"><p class="brand">agent-test</p><h1>${canRun ? "Test viewer" : "Run report"}</h1></div>
	  <div class="run-context">
		<label class="toolbar-label" for="run-history">Viewing run</label>
		<select class="run-history" id="run-history" aria-label="Run history"${canRun ? "" : " disabled"}>${historyOptions}</select>
	  </div>
      <p class="run-banner${canRun ? "" : " lede"}" id="run-banner" aria-live="polite">${canRun ? "Choose a test to inspect or run." : escapeHtml(options.headerLede ?? "Read-only report.")}</p>
    </header>
	<div class="viewer-command-row">
      <div class="toolbar-block"><p class="toolbar-label">Hosts</p><div class="host-toggles">${hostToggles}</div></div>
      <label class="parallel-control"><input type="checkbox" id="parallel-hosts" checked> Run hosts together</label>
      <button class="primary run-toggle" id="run-selection" data-start-label="Start run"${canRun ? "" : ' disabled data-fixed-disabled="1"'}>Start run</button>
    </div>
	${options.overviewHtml ?? ""}
    <section class="run-progress" id="run-progress" aria-live="polite" hidden>
      <div class="run-progress-head">
        <p class="run-progress-title">0 of 0 tests finished</p>
      </div>
      <div class="run-progress-track" role="progressbar" aria-label="Suite run progress" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0">
        <span class="run-progress-fill"></span>
      </div>
      <div class="run-progress-counts">
        <span class="progress-passed">Passed <strong>0</strong></span>
        <span class="progress-failed">Failed <strong>0</strong></span>
        <span class="progress-skipped">Skipped <strong>0</strong></span>
        <span class="progress-remaining">Remaining <strong>0</strong></span>
      </div>
    </section>
    <div class="viewer-workspace">
      ${navigator}
      <section class="test-stage" aria-label="Selected test">${suites}</section>
    </div>
  </main>
	<script type="application/json" id="catalog-data">${embedJson(catalog)}</script>
  <script type="application/json" id="bootstrap-data">${embedJson(bootstrap)}</script>
  <script type="text/javascript">
${canRun ? clientScript() : staticNavigationScript()}
  </script>
</body>
</html>
`;
}
