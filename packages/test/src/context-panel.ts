import type { ContextMode, ScenarioContextFile } from "./types.js";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function contextFileCountLabel(count: number): string {
	return count === 1 ? "1 file" : `${count} files`;
}

function renderContextFile(file: ScenarioContextFile, open: boolean): string {
	const openAttr = open ? " open" : "";
	return `<li>
    <details class="context-file"${openAttr} data-reason="${escapeHtml(file.reason)}" data-path="${escapeHtml(file.path)}">
      <summary>
        <span class="context-path">${escapeHtml(file.path)}</span>
        <span class="context-why">${escapeHtml(file.why)}</span>
      </summary>
      <pre class="context-body">${escapeHtml(file.text)}</pre>
    </details>
  </li>`;
}

function renderHostInput(hostInput?: string): string {
	if (hostInput === undefined) return "";
	return `<details class="context-host-input" open>
    <summary>Exact submitted user input</summary>
    <pre class="context-body">${escapeHtml(hostInput)}</pre>
  </details>`;
}

function renderDeliveryFlow(mode: ContextMode): string {
	const middle = mode === "host-native" ? "Host discovery" : "Harness preamble";
	return `<div class="context-flow" aria-label="Scenario prompt delivery path">
    <span class="context-flow-node">Scenario</span><span class="context-flow-arrow" aria-hidden="true">→</span><span class="context-flow-node context-flow-mode">${middle}</span><span class="context-flow-arrow" aria-hidden="true">→</span><span class="context-flow-node">Host</span>
  </div>`;
}

/** Context-delivery visual for the viewer and HTML report. */
export function renderContextPanel(
	files: ScenarioContextFile[] = [],
	mode: ContextMode = "harness-preamble",
	hostInput?: string,
): string {
	const count = files.length;
	if (mode === "host-native") {
		return `<details class="context-panel" open data-context-mode="host-native" data-file-count="0">
  <summary class="context-panel-summary"><span class="context-panel-title">Context delivery</span><span class="context-panel-count">Host-native</span></summary>
  ${renderDeliveryFlow(mode)}
  ${renderHostInput(hostInput)}
  <p class="context-panel-lede">No harness preamble. Workspace files remain on disk for the host to discover.</p>
  <p class="context-empty">Host-owned system instructions and native discovery are not exposed as one inspectable payload. agent-test does not claim which workspace instructions or skills the host loaded.</p>
</details>`;
	}
	const body =
		count === 0
			? `<p class="context-empty">No preamble files. The agent received the prompt only.</p>`
			: `<p class="context-panel-lede">These files were in the host preamble for this run.</p>
  <ol class="context-files">${files.map((file) => renderContextFile(file, count === 1)).join("")}</ol>`;
	return `<details class="context-panel" open data-context-mode="harness-preamble" data-file-count="${String(count)}">
  <summary class="context-panel-summary"><span class="context-panel-title">Context delivery</span><span class="context-panel-count">Harness preamble · ${escapeHtml(contextFileCountLabel(count))}</span></summary>
  ${renderDeliveryFlow(mode)}
  ${renderHostInput(hostInput)}
  ${body}
</details>`;
}
