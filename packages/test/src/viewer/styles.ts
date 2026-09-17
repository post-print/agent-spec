export function viewerCss(): string {
	return `
    :root {
      color-scheme: dark;
      --bg: oklch(0.155 0.018 258);
      --sidebar: oklch(0.19 0.022 258);
      --panel: oklch(0.205 0.024 258);
      --panel-2: oklch(0.23 0.026 258);
      --panel-3: oklch(0.255 0.03 258);
      --text: oklch(0.95 0.012 255);
      --muted: oklch(0.72 0.03 255);
      --subtle: oklch(0.61 0.03 255);
      --border: oklch(0.315 0.035 258);
      --border-strong: oklch(0.4 0.045 258);
      --accent: oklch(0.72 0.12 175);
      --accent-soft: oklch(0.72 0.12 175 / 0.12);
      --pass: oklch(0.79 0.16 155);
      --pass-soft: oklch(0.79 0.16 155 / 0.11);
      --fail: oklch(0.73 0.18 25);
      --fail-soft: oklch(0.73 0.18 25 / 0.11);
      --skip: oklch(0.82 0.14 85);
      --skip-soft: oklch(0.82 0.14 85 / 0.11);
      --focus: oklch(0.78 0.16 235);
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, p { margin-block: 0; }
    .message-markdown > :first-child { margin-block-start: 0; }
    .message-markdown > :last-child { margin-block-end: 0; }
    .message-markdown p {
      margin-block: 0 0.55rem;
      white-space: pre-wrap;
    }
    .message-markdown ul,
    .message-markdown ol {
      margin-block: 0.45rem;
      padding-inline-start: 1.35rem;
    }
    .message-markdown li { padding-inline-start: 0.1rem; }
    .message-markdown li + li { margin-top: 0.25rem; }
    .message-markdown strong { font-weight: 750; }
    .message-markdown em { color: var(--muted); }
    .message-markdown code {
      padding: 0.08rem 0.25rem;
      border-radius: 4px;
      background: var(--panel-3);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.92em;
    }
    .message-markdown pre {
      max-width: 100%;
      margin-block: 0.55rem;
      padding: 0.65rem 0.75rem;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
    }
    .message-markdown pre code {
      display: block;
      padding: 0;
      border-radius: 0;
      background: transparent;
      font-size: 0.74rem;
    }
    .message-markdown a {
      color: var(--accent);
      text-underline-offset: 0.15em;
    }
    .message-markdown blockquote {
      margin: 0.55rem 0;
      padding-inline-start: 0.75rem;
      border-inline-start: 2px solid var(--border-strong);
      color: var(--muted);
    }
    button, select { font-family: inherit; }
    button:focus-visible, select:focus-visible, summary:focus-visible, a:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 3px;
    }
    button:disabled { cursor: not-allowed; opacity: 0.5; }
    summary { list-style: none; }
    summary::-webkit-details-marker { display: none; }
  `;
}
