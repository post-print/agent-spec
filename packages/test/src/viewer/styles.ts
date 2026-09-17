export function reportCss(): string {
	return `
  @layer reset, base, layout, components;
  :root {
    color-scheme: dark;
    --bg: oklch(0.18 0.02 250);
    --panel: oklch(0.23 0.025 250);
    --panel-2: oklch(0.2 0.022 250);
    --text: oklch(0.93 0.015 250);
    --muted: oklch(0.72 0.03 250);
    --border: oklch(0.32 0.03 250);
    --pass: oklch(0.8 0.16 155);
    --fail: oklch(0.72 0.16 20);
    --skip: oklch(0.84 0.14 85);
    --user-bubble: oklch(0.3 0.06 250);
    --assistant-bubble: oklch(0.26 0.04 155);
    --system-bubble: oklch(0.26 0.04 300);
    --tool: oklch(0.82 0.12 80);
    --tool-bubble: oklch(0.26 0.04 80);
    --arm-a: oklch(0.72 0.12 250);
    --arm-b: oklch(0.78 0.14 75);
    --arm-0: var(--arm-a);
    --arm-1: var(--arm-b);
    --arm-2: oklch(0.76 0.13 145);
    --arm-3: oklch(0.74 0.12 20);
  }
  @layer reset {
    * { box-sizing: border-box; }
    body { margin: 0; }
    h1, h2, h3, h4, p, ol { margin: 0; }
    dl, dd { margin: 0; }
  }
  @layer base {
    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      word-spacing: normal;
    }
    main { max-width: 68rem; margin-inline: auto; padding: 1.5rem 1.25rem 3rem; }
    main:has(.compare-layout) { max-width: 96rem; }
    h1 { font-size: 1.7rem; font-weight: 650; letter-spacing: -0.02em; }
    h2 { font-size: 1.05rem; font-weight: 650; }
    h3 { font-size: 0.8rem; color: var(--muted); font-weight: 650; }
    h4 { font-size: 0.75rem; margin-block: 0.9rem 0.35rem; color: var(--muted); font-weight: 650; }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-size: 0.85rem; font-style: italic; }
    .empty.note { margin-bottom: 0.5rem; }
  }
  @layer layout {
    .report-header { display: grid; gap: 0.25rem; margin-bottom: 1rem; }
    .brand { color: var(--muted); font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .lede, .when { color: var(--muted); font-size: 0.85rem; }
    .summary, .cost, .guide, .compare {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.9rem 1rem;
    }
    .summary { display: grid; gap: 0.65rem; }
    .stats { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .suite { margin-top: 1.75rem; display: grid; gap: 0.55rem; }
    .suite-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
    .suite-title { display: flex; align-items: center; gap: 0.5rem; }
    .cost { margin-top: 0.85rem; display: grid; gap: 0.65rem; }
    .cost-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.75rem; }
    .guide { margin-top: 0.85rem; }
    .diagnostics { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.7rem; margin-bottom: 0.9rem; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.45rem 0.75rem; }
  }
  @layer components {
    .stat {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
      padding: 0.4rem 0.65rem;
      border-radius: 8px;
      background: var(--panel-2);
      font-size: 0.85rem;
    }
    .stat strong { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
    .stat-pass strong { color: var(--pass); }
    .stat-fail strong { color: var(--fail); }
    .stat-skip strong { color: var(--skip); }
    .guide h2 { font-size: 0.95rem; }
    .guide ol { margin: 0.65rem 0 0; padding-inline-start: 1.2rem; display: grid; gap: 0.35rem; color: var(--muted); font-size: 0.88rem; }
    .cost-lede { color: var(--muted); font-size: 0.85rem; }
    .cost-item { display: grid; gap: 0.15rem; }
    .cost-value { font-size: 1.2rem; font-weight: 650; font-variant-numeric: tabular-nums; }
    .cost-label { font-size: 0.8rem; font-weight: 650; }
    .cost-detail { color: var(--muted); font-size: 0.75rem; }
    .host {
      color: var(--muted);
      font-size: 0.72rem;
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
    }
    .suite-counts { display: flex; flex-wrap: wrap; gap: 0.75rem; color: var(--muted); font-size: 0.85rem; }
    .tokens { color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
    .usage-summary, .scenario-meta {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.65rem 0.7rem;
    }
    .meta-item { display: grid; gap: 0.1rem; }
    .meta-key { color: var(--muted); font-size: 0.75rem; }
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
  .scenario-heading { display: grid; gap: 0.1rem; min-width: 12rem; flex: 1 1 16rem; }
  .scenario-name { font-weight: 600; font-size: 0.9rem; }
  .scenario-lede { color: var(--muted); font-size: 0.78rem; font-weight: 400; }
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
  .diagnostics { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.7rem; margin-bottom: 0.9rem; }
  .diagnostics section { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 0.7rem; min-width: 0; }
  .conversation { min-width: 0; }

	.story { margin-bottom: 0.85rem; }
	.story-criteria { display: grid; gap: 0.55rem; }
	.story-criteria > h3 { margin: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
	.story-section { display: grid; gap: 0.3rem; }
	.story-section + .story-section { padding-block-start: 0.55rem; border-block-start: 1px solid var(--border); }
	.story-section h4 { margin: 0; font-size: 0.84rem; color: var(--text); }
  .story-section-description { margin: 0 0 0.4rem; color: var(--muted); font-size: 0.82rem; }
  .story-list, .story-checks, .story-notes { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; color: var(--text); }
  .story-checks { list-style: none; padding-left: 0; }
  .story-check { display: flex; gap: 0.4rem; }
  .story-check-icon { width: 1rem; flex: none; font-weight: 700; }
  .story-check-pass .story-check-icon { color: var(--pass); }
  .story-check-fail .story-check-icon { color: var(--fail); }
  .story-notes { color: var(--muted); }
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
	.judge-evidence { margin: 0.35rem 0 0; padding-inline-start: 1.1rem; color: var(--muted); font-size: 0.78rem; }
	.judge-exchange { margin-block-start: 0.5rem; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
	.judge-exchange > summary { cursor: pointer; padding: 0.4rem 0.55rem; color: var(--muted); font-size: 0.75rem; font-weight: 650; }
	.judge-exchange[open] > summary { border-block-end: 1px solid var(--border); background: var(--panel); }
	.judge-chat { display: grid; gap: 0.55rem; padding: 0.55rem; }
	.judge-turn { display: grid; gap: 0.25rem; min-width: 0; }
	.judge-turn > span { color: var(--muted); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
	.judge-turn pre { max-height: 22rem; margin: 0; padding: 0.5rem; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: #0b1017; color: var(--text); font: 0.72rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
	.judge-response pre { border-inline-start: 3px solid var(--pass); }

  .chat {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 46rem;
    word-spacing: normal;
    letter-spacing: normal;
  }
  .chat-row { display: flex; }
  .chat-row.side-left { justify-content: flex-start; }
  .chat-row.side-right { justify-content: flex-end; }
  .chat-row.side-center { justify-content: center; }
  .bubble {
    max-width: min(40rem, 92%);
    border-radius: 10px;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    word-spacing: normal;
  }
  .bubble-label {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 0.35rem;
  }
  .bubble-text {
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: normal;
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .bubble.role-user { background: var(--user-bubble); border-top-right-radius: 3px; }
  .bubble.role-assistant { background: var(--assistant-bubble); border-top-left-radius: 3px; }
  .bubble.role-context {
    background: color-mix(in srgb, var(--skip) 14%, var(--panel-2));
    max-width: min(44rem, 94%);
  }
  .bubble.role-system, .bubble.role-tool { background: var(--system-bubble); font-size: 0.88rem; max-width: min(42rem, 94%); }

  .tool-card {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.3rem 0.55rem;
	width: fit-content;
	max-width: min(40rem, 100%);
	border-radius: 7px;
	padding: 0.38rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--tool) 35%, var(--border));
    background: var(--tool-bubble);
    word-spacing: normal;
  }
  .tool-card-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
	font-size: 0.74rem;
    font-weight: 700;
    color: var(--tool);
  }
	.tool-icon { display: none; }
  .tool-name { font-weight: 700; }
  .tool-args {
	margin-top: 0;
	display: grid;
	gap: 0.22rem;
	padding-top: 0;
	border-top: 0;
  }
  .tool-arg {
    display: grid;
	grid-template-columns: max-content minmax(0, 1fr);
	gap: 0.3rem 0.45rem;
    align-items: start;
	font-size: 0.72rem;
  }
  .tool-arg-key { color: var(--muted); padding-top: 0.2rem; }
  .tool-arg code {
    display: block;
    color: var(--text);
    background: #0b1017;
    border-radius: 6px;
	padding: 0.18rem 0.35rem;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: pre-wrap;
	line-height: 1.3;
  }

  .shell-commands { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 0.3rem; }
  .shell-commands li { font-size: 0.8rem; background: #0b1017; border: 1px solid var(--border); border-radius: 6px; padding: 0.3rem 0.5rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  .trace-details { margin-top: 0.75rem; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .trace-details summary { cursor: pointer; display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.55rem 0.7rem; font-size: 0.82rem; font-weight: 650; }
  .trace-details summary span { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; }
  .trace-details[open] summary { border-bottom: 1px solid var(--border); background: var(--panel-2); }
  .trace-details > .chat, .trace-details > h4, .trace-details > .shell-commands, .trace-details > .empty { margin-inline: 0.7rem; }
  .trace-details > .chat { margin-block: 0.7rem; }
  .trace-details > .shell-commands { margin-bottom: 0.7rem; }

  .compare-layout {
    container-type: inline-size;
    display: grid;
    gap: 0.9rem;
  }
  .compare-tablist {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .compare-tab-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .compare-tab {
    font: inherit;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    padding: 0.35rem 0.65rem;
    cursor: pointer;
  }
  .compare-tab-input:checked + .compare-tab,
  .compare-tab[aria-selected="true"] {
    background: color-mix(in srgb, var(--pass) 16%, var(--panel-2));
    border-color: color-mix(in srgb, var(--pass) 40%, var(--border));
  }
  .compare-tabs .compare-arms,
  .compare-tabs .compare-arms[data-arm-count] {
    grid-template-columns: minmax(0, 1fr);
  }
  .compare-tabs .compare-arm { display: none; }
  .compare-arms {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.85rem;
    align-items: stretch;
  }
  .compare-arms[data-arm-count="3"],
  .compare-arms[data-arm-count="4"] {
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  }
  .compare-arm {
    min-width: 0;
    display: grid;
    align-content: start;
    gap: 0.65rem;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.75rem 0.8rem 0.85rem;
    border-block-start-width: 3px;
    border-block-start-color: var(--arm-accent, var(--arm-a));
  }
  .compare-arm-a { border-block-start-color: var(--arm-a); }
  .compare-arm-b { border-block-start-color: var(--arm-b); }
  .compare-arm-header { display: grid; gap: 0.15rem; padding-bottom: 0.55rem; border-bottom: 1px solid var(--border); }
  .compare-arm-kicker {
    color: var(--muted);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .compare-arm .compare-arm-kicker { color: var(--arm-accent, var(--muted)); }
  .compare-arm-a .compare-arm-kicker { color: var(--arm-a); }
  .compare-arm-b .compare-arm-kicker { color: var(--arm-b); }
  .compare-arm-header h3 { color: var(--text); font-size: 0.95rem; }
  .compare-arm-description { color: var(--muted); font-size: 0.8rem; }
  .compare-arm-metrics { color: var(--muted); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
  .compare-arm .bubble, .compare-arm .tool-card { max-width: 100%; }

  .compare {
    margin-top: 0;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.85rem 0.9rem 1rem;
  }
  .compare-header { margin-bottom: 0.65rem; }
  .compare-header h3, .compare-header h4 { margin-bottom: 0.2rem; }
  .story-criteria > .comparison-metrics { margin-top: 0.85rem; padding: 0.8rem 0 0; background: transparent; border: 0; border-top: 1px solid var(--border); border-radius: 0; }
  .compare-winners { margin: 0 0 0.75rem; }
  .compare-winners h3 { margin-bottom: 0.35rem; }
  .compare-winners ul {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .compare-winner-pass { color: var(--pass); }
  .compare-winner-fail { color: var(--fail); }
  .compare-callouts {
	margin: 0.5rem 0 0;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
  .compare-details { margin-top: 0.65rem; color: var(--muted); font-size: 0.78rem; }
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
  .delta-up { color: var(--fail); }
  .delta-down { color: var(--pass); }
  .delta-flat { color: var(--muted); }
  .compare-table td.is-better { color: var(--pass); font-weight: 650; background: color-mix(in srgb, var(--pass) 12%, transparent); }
  .compare-table td.is-worse { color: var(--fail); font-weight: 650; background: color-mix(in srgb, var(--fail) 12%, transparent); }
	.compare-table td.is-outcome-pass { color: var(--pass); font-weight: 650; }
	.compare-table td.is-outcome-fail { color: var(--fail); font-weight: 650; background: color-mix(in srgb, var(--fail) 12%, transparent); }
	.compare-table td.is-expected-failure { color: var(--muted); font-weight: 650; background: color-mix(in srgb, var(--muted) 9%, transparent); }
  .is-better { color: var(--pass); font-weight: 650; }
  .is-worse { color: var(--fail); font-weight: 650; }

  @container (max-width: 44rem) {
    .compare-arms { grid-template-columns: minmax(0, 1fr); }
  }

  @media (max-width: 720px) {
    main { padding: 0.75rem; }
    .suite-header { align-items: flex-start; flex-direction: column; gap: 0.2rem; }
    .diagnostics { grid-template-columns: 1fr; }
    .bubble, .tool-card { max-width: 92%; }
    .compare-arms { grid-template-columns: minmax(0, 1fr); }
  }
  }
`;
}
