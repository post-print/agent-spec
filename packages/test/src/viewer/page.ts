import { existsSync, readFileSync } from "node:fs";

import type { ViewerCatalog } from "./catalog.js";
import type { ViewerBootstrap } from "./events.js";

export interface ViewerPageRenderOptions {
	baseCss?: string;
}

function embedJson(value: unknown): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function viewerClient(): string {
	const candidates = [
		new URL("./client.js", import.meta.url),
		new URL("../../dist/viewer/client.js", import.meta.url),
	];
	const bundle = candidates.find((candidate) => existsSync(candidate));
	if (!bundle) {
		throw new Error("Viewer client bundle is missing. Run the @post-print/agent-test build first.");
	}
	return readFileSync(bundle, "utf8").replaceAll("</script", "<\\/script");
}

function viewerCss(): string {
	return `
  html { font-size: 87.5%; }
  html, body, #viewer-root { height: 100%; }
  body { overflow: hidden; word-spacing: normal; }
  button, select, input { font: inherit; }
  button { min-height: 2rem; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text); padding: .38rem .68rem; line-height: 1.2; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  button.primary { background: color-mix(in srgb, var(--pass) 18%, var(--panel-2)); border-color: color-mix(in srgb, var(--pass) 40%, var(--border)); }
  button.danger { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 45%, var(--border)); }
  .viewer-shell { display: flex; flex-direction: column; width: 100%; max-width: 96rem; height: 100vh; height: 100dvh; margin: 0 auto; overflow: hidden; padding: .65rem .9rem; }
  .viewer-topbar { display: flex; align-items: end; border-block-end: 1px solid var(--border); padding-block-end: .65rem; }
  .viewer-identity h1 { margin: 0; font-size: 1.35rem; }
  .section-label, .toolbar-label, .task-meta-label { color: var(--muted); font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .run-history { min-width: 10rem; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2); color: var(--text); padding: .45rem .6rem; }
  .run-banner { color: var(--muted); font-size: .82rem; }
  .viewer-command-row { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem 1rem; padding-block: .55rem; }
  .toolbar-block { display: flex; align-items: center; gap: .65rem; }
  .toolbar-block .toolbar-label { margin: 0; }
  .sidebar-toggle { display: inline-grid; place-items: center; width: 2rem; min-height: 2rem; padding: 0; }
  .sidebar-toggle svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.8; }
  .host-toggles, .scenario-actions, .host-tablist, .compare-tablist, .compare-definition-tabs { display: flex; flex-wrap: wrap; gap: .4rem; }
  .host-toggles label, .parallel-control, .worker-control, .run-actions { display: inline-flex; align-items: center; gap: .3rem; font-size: .82rem; }
  .worker-control input { min-inline-size: 4.25rem; }
  .viewer-workspace { display: grid; grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr); flex: 1 1 auto; min-height: 0; gap: .75rem; overflow: hidden; }
  .viewer-workspace[data-sidebar-open="false"] { grid-template-columns: minmax(0, 1fr); }
  .test-navigator { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: .6rem; }
  .test-navigator-heading h2, .test-nav-suite h2 { margin: 0; }
  .test-picker-label, .test-picker { display: none; }
  .test-nav-suite { margin-block-start: .7rem; }
  .test-nav-suite > header { display: flex; gap: .5rem; align-items: center; justify-content: space-between; }
  .test-nav-suite h2 { font-size: .72rem; color: var(--muted); }
  .test-navigator .run-suite { min-height: 1.55rem; border-radius: 6px; padding: .18rem .45rem; font-size: .68rem; line-height: 1.1; }
  .test-nav-items { display: grid; gap: .25rem; margin-block-start: .35rem; }
  .test-nav-item { display: grid; grid-template-columns: .55rem 1fr; gap: .4rem; width: 100%; text-align: start; padding: .42rem; }
  .test-nav-item[aria-current="true"] { border-color: color-mix(in srgb, var(--pass) 50%, var(--border)); background: color-mix(in srgb, var(--pass) 12%, var(--panel-2)); }
  .test-nav-status { width: .55rem; height: .55rem; margin-block-start: .18rem; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 50%; background: var(--border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--panel-2) 80%, transparent); }
  .test-nav-item[data-status="passed"] .test-nav-status { background: var(--pass); }
  .test-nav-item[data-status="failed"] .test-nav-status { background: var(--fail); }
  .test-nav-item[data-status="running"] .test-nav-status { background: var(--skip); }
  .test-nav-copy { display: grid; min-width: 0; gap: .08rem; font-size: .82rem; line-height: 1.22; }
  .test-nav-copy small { color: var(--muted); font-size: .68rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .test-stage { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .scenario-card { min-width: 0; }
  .scenario-card[hidden] { display: none; }
  .scenario-card { display: grid; gap: .75rem; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); padding: .75rem .85rem; }
  .scenario-focus-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 1rem; padding-block-end: .85rem; border-block-end: 1px solid var(--border); }
  .scenario-heading-copy { display: grid; gap: .2rem; min-width: 0; }
  .scenario-path { color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .scenario-focus-header h2 { font-size: 1.2rem; line-height: 1.25; text-wrap: balance; }
  .scenario-focus-header .scenario-lede { color: var(--muted); font-size: .84rem; line-height: 1.4; }
  .diagnostics { display: grid; grid-template-columns: minmax(0, 1fr); gap: .7rem; margin-bottom: .9rem; }
  .diagnostics > * { min-width: 0; }
  .focus-verdict { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid var(--border); border-radius: 999px; padding: .22rem .55rem; color: var(--muted); font-size: .72rem; font-weight: 650; white-space: nowrap; }
  .focus-verdict > span { width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
  .focus-verdict[data-status="passed"] { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 40%, var(--border)); }
  .focus-verdict[data-status="failed"] { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, var(--border)); }
  .focus-verdict[data-status="running"], .focus-verdict[data-status="cancelling"] { color: var(--skip); border-color: color-mix(in srgb, var(--skip) 40%, var(--border)); }
  .scenario-definition { display: grid; gap: 1rem; }
  .scenario-detail { display: grid; gap: .3rem; }
  .scenario-detail h2, .scenario-detail p { margin: 0; }
  .test-intent { display: grid; gap: .35rem; }
  .prompt-preview { color: var(--text); font-size: .92rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .rubric-line, .arm-note { color: var(--muted); font-size: .8rem; white-space: pre-wrap; }
  .scenario-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem 1rem; align-items: end; border-block-start: 1px solid var(--border); padding-block-start: .85rem; }
  .host-runs { display: flex; align-items: center; gap: .55rem; }
  .host-runs-label { color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .host-tablist { gap: .3rem; }
  .host-tab { min-height: 0; padding: .22rem .42rem; font-size: .72rem; line-height: 1.15; }
  .cell-status { margin-inline-start: .1rem; color: var(--muted); font-size: .62rem; font-weight: 500; text-transform: capitalize; }
  .host-tab[aria-selected="true"], .compare-tab[aria-selected="true"], .compare-definition-tab[aria-selected="true"] { border-color: color-mix(in srgb, var(--pass) 50%, var(--border)); background: color-mix(in srgb, var(--pass) 14%, var(--panel-2)); }
  .task-definition { display: grid; gap: .8rem; border: 1px solid var(--border); border-radius: 12px; padding: .9rem; }
  .task-definition-header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
  .task-definition-header h3, .criteria > h3 { margin: 0; }
  .task-description { font-size: .96rem; }
  .task-prompt { margin: 0; padding: .75rem; border-radius: 8px; background: var(--panel-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .starting-context { border-block-start: 1px solid var(--border); padding-block: .55rem .8rem; }
  .criteria-panel { border-block-start: 1px solid var(--border); padding-block: .55rem .8rem; }
  .criteria-panel > summary { cursor: pointer; padding-block: .1rem .55rem; font-weight: 650; }
  .criteria-panel[open] > summary { margin-block-end: .35rem; }
  .criteria-summary { margin-inline-start: .8rem; color: var(--muted); font-size: .75rem; font-weight: 500; }
  .criteria-empty { color: var(--muted); font-size: .84rem; }
  .criteria { display: grid; gap: .75rem; }
  .criterion-groups { display: flex; flex-direction: row; align-items: stretch; gap: .45rem; }
  .criterion-groups > .criterion-group { flex: 1 1 0; min-width: 0; }
  .criterion-group { border: 1px solid var(--border); border-radius: 10px; padding: .7rem; background: var(--panel-2); }
  .criterion-group h4 { margin: 0 0 .45rem; }
  .criterion-group p { color: var(--muted); font-size: .82rem; line-height: 1.45; }
  .criterion-list { margin: 0; padding-inline-start: 1.2rem; font-size: .86rem; line-height: 1.45; }
  .source-folder-link { color: var(--text); overflow-wrap: anywhere; text-decoration-color: color-mix(in srgb, var(--text) 45%, transparent); text-underline-offset: .18em; }
  .source-folder-link:hover { text-decoration-color: currentColor; }
  .criterion-group p + .criterion-list { margin-block-start: .5rem; }
  .criterion-list li + li { margin-block-start: .38rem; }
  .comparison-task, .comparison-criteria, .compare-definition-tabbed { display: grid; gap: .4rem; }
  .comparison-intro { color: var(--muted); font-size: .84rem; }
  .comparison-criteria .criterion-groups { margin-block-start: .2rem; }
  .compare-definition-tabbed { gap: .55rem; }
  .compare-arm-definition { display: grid; gap: .75rem; border-block-start: 1px solid var(--border); padding-block-start: .8rem; }
  .compare-arm-header { display: grid; gap: .2rem; }
  .compare-arm-header h3 { color: var(--text); font-size: .95rem; }
  .compare-arm-description { color: var(--muted); font-size: .82rem; line-height: 1.4; }
  .comparison-definition { display: grid; gap: .75rem; border: 1px solid color-mix(in srgb, var(--skip) 35%, var(--border)); border-radius: 12px; padding: .85rem; }
  .compare-definition-arms, .compare-arms, .compare-definition-arm, .compare-arm { min-width: 0; }
  .compare-tabs .compare-arm { border-block-start-width: 1px; border-block-start-color: var(--border); }
  .scenario-live { display: grid; gap: .8rem; }
  .live-cell { border: 1px solid var(--border); border-radius: 12px; background: var(--panel-2); padding: .8rem; }
  .live-status { max-height: 9rem; overflow: auto; color: var(--muted); font: .75rem ui-monospace, monospace; }
  .chat-running-row[hidden] { display: none; }
  .chat-running { display: inline-flex; align-items: center; gap: .45rem; color: var(--muted); font-size: .85rem; padding: .2rem .1rem; }
  .chat-progress { display: inline-flex; gap: .18rem; }
  .chat-progress span { width: .32rem; height: .32rem; border-radius: 999px; background: var(--skip); animation: chat-progress 1s ease-in-out infinite; }
  .chat-progress span:nth-child(2) { animation-delay: .15s; }
  .chat-progress span:nth-child(3) { animation-delay: .3s; }
  @keyframes chat-progress { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
  .bubble.is-streaming .bubble-text::after { content: "▍"; margin-inline-start: .12rem; color: var(--pass); animation: chat-caret 1s step-end infinite; }
  @keyframes chat-caret { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .chat-progress span, .bubble.is-streaming .bubble-text::after { animation: none; }
    .run-progress-segment { transition: none; }
  }
  .run-progress { border: 1px solid var(--border); border-radius: 10px; padding: .7rem; margin-bottom: .8rem; }
  .run-progress-title { margin: 0 0 .4rem; }
  .run-progress-track { display: flex; height: .5rem; border-radius: 999px; background: var(--panel-2); overflow: hidden; }
  .run-progress-segment { display: block; height: 100%; transition: width .2s ease; }
  .run-progress-passed { background: var(--pass); }
  .run-progress-failed { background: var(--fail); }
  .run-progress-skipped { background: var(--skip); }
  .run-progress-counts { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: .4rem; font-size: .78rem; color: var(--muted); }
  .progress-passed strong { color: var(--pass); }
  .progress-failed strong { color: var(--fail); }
  .progress-skipped strong { color: var(--skip); }
  .failure-panel { border-color: color-mix(in oklch, var(--fail) 42%, var(--border)); background: color-mix(in oklch, var(--fail) 5%, var(--panel-2)); }
  .failure-section-head { display: flex; align-items: start; justify-content: space-between; gap: .75rem; padding-block-end: .65rem; border-block-end: 1px solid color-mix(in oklch, var(--fail) 22%, var(--border)); }
  .failure-section-head h3 { color: var(--text); font-size: .86rem; }
  .failure-section-head p { margin-block-start: .12rem; color: var(--muted); font-size: .72rem; }
  .copy-error { min-height: 0; flex: none; padding: .28rem .48rem; font-size: .7rem; }
  .failures { display: grid; gap: .65rem; margin-block-start: .7rem; }
  .failures .failure-item { display: grid; gap: .32rem; padding: .62rem .68rem; border: 1px solid color-mix(in oklch, var(--fail) 24%, var(--border)); border-inline-start: 3px solid var(--fail); border-radius: 8px; background: color-mix(in oklch, var(--fail) 5%, var(--panel)); }
  .failure-label { color: var(--fail); font-size: .68rem; font-weight: 750; letter-spacing: .055em; text-transform: uppercase; }
  .failure-message { margin: 0; padding: 0; border: 0; background: transparent; color: var(--text); font: 650 .84rem/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; white-space: pre-wrap; overflow-wrap: anywhere; }
  .failure-evidence-details { margin-block-start: .12rem; border-block-start: 1px solid var(--border); }
  .failure-evidence-details > summary { cursor: pointer; padding-block: .42rem .1rem; color: var(--muted); font-size: .72rem; font-weight: 650; }
  .failure-evidence { max-height: 11rem; margin: .4rem 0 0; padding: .5rem .55rem; overflow: auto; border: 1px dashed var(--border); border-radius: 6px; background: color-mix(in oklch, black 28%, var(--panel)); color: var(--muted); font: .7rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .story-criteria { padding-block: .55rem .8rem; }
  .story-criteria > h3 { margin: 0 0 .55rem; }
  .judge-responses { display: grid; gap: .7rem; padding-block: .25rem .8rem; }
  .judge-responses-inline { border: 0; background: transparent; padding: .75rem 0 0 1rem; }
  .judge-response { display: grid; gap: .65rem; width: 100%; border: 1px solid color-mix(in oklch, var(--arm-a) 32%, var(--border)); border-radius: 12px; background: color-mix(in oklch, var(--arm-a) 7%, var(--panel)); padding: .9rem 1rem; }
  .judge-response-inline { gap: .4rem; border: 0; border-radius: 0; background: transparent; padding: 0; color: color-mix(in oklch, var(--arm-a) 72%, var(--text)); }
  .judge-answer-label { margin: 0; color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .055em; text-transform: uppercase; }
  .judge-response-inline .judge-rationale, .judge-response-inline .judge-evidence, .judge-response-inline .judge-evidence q { color: inherit; }
  .judge-response-head { display: flex; align-items: start; justify-content: space-between; gap: .75rem; }
  .judge-response-head h3 { margin: 0; font-size: .95rem; }
  .judge-verdict-badge { flex: none; padding: .15rem .38rem; border: 1px solid currentColor; border-radius: 999px; font-size: .62rem; font-weight: 800; letter-spacing: .055em; text-transform: uppercase; }
  .judge-response.verdict-pass .judge-verdict-badge { color: var(--pass); }
  .judge-response.verdict-fail .judge-verdict-badge { color: var(--fail); }
  .judge-response.verdict-pending .judge-verdict-badge { color: var(--skip); }
  .judge-rationale { margin: 0; color: var(--text); font-size: .95rem; line-height: 1.55; white-space: pre-wrap; }
  .judge-evidence { display: grid; gap: .35rem; margin: 0; padding-inline-start: 1.2rem; color: var(--muted); font-size: .85rem; line-height: 1.5; }
  .judge-evidence q { color: var(--text); }
  .trace-command-list { display: grid; gap: .45rem; margin-block-start: .7rem; padding-block-start: .65rem; border-block-start: 1px solid var(--border); }
  .trace-command-list h4 { margin: 0; font-size: .8rem; }
  .trace-details .trace-summary-title { color: var(--text); font-weight: 700; }
  .trace-details .trace-summary-meta { margin-inline-start: auto; color: var(--muted); font-weight: 400; }
  .viewer-shell .chat { max-inline-size: none; }
  @media (max-width: 760px) {
    .viewer-shell { padding: .75rem; }
    .viewer-topbar { align-items: start; }
    .run-banner { text-align: start; }
    .viewer-workspace { grid-template-columns: 1fr; }
    .test-navigator { overflow: visible; }
    .test-picker-label { display: block; margin-top: .7rem; }
    .test-picker { display: block; width: 100%; margin-top: .3rem; }
    .test-tree { display: none; }
    .criterion-groups { flex-direction: column; }
    .scenario-focus-header { grid-template-columns: 1fr; gap: .55rem; }
    .focus-verdict { justify-self: start; }
  }
`;
}

/** Render the self-contained shell used by both the live viewer and saved reports. */
export function renderViewerPage(
	input: ViewerCatalog | ViewerBootstrap,
	options: ViewerPageRenderOptions = {},
): string {
	const bootstrap: ViewerBootstrap =
		"catalog" in input ? input : { catalog: input, runs: [], capabilities: { canRun: true } };
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>agent-test ${bootstrap.capabilities.canRun ? "viewer" : "report"}</title>
  <style>${options.baseCss ?? ""}${viewerCss()}</style>
</head>
<body>
  <div id="viewer-root"></div>
  <script type="application/json" id="catalog-data">${embedJson(bootstrap.catalog)}</script>
  <script type="application/json" id="bootstrap-data">${embedJson(bootstrap)}</script>
  <script>${viewerClient()}</script>
</body>
</html>`;
}
