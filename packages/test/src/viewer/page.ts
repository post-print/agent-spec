import { reportCss } from "../html-report.js";
import type { ViewerCatalog, ViewerCatalogScenario, ViewerCatalogSuite } from "./catalog.js";

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
  .matrix { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .matrix th, .matrix td { border: 1px solid var(--border); padding: 0.5rem 0.55rem; text-align: left; vertical-align: top; }
  .matrix th { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .scenario-detail { display: grid; gap: 0.35rem; }
  .prompt-preview { color: var(--muted); font-size: 0.78rem; white-space: pre-wrap; }
  .rubric-line { font-size: 0.75rem; color: var(--muted); }
  .arm-note { font-size: 0.78rem; color: var(--muted); }
  .cell-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .cell-status { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; }
  .live-dock { margin-top: 1.5rem; display: grid; gap: 0.85rem; }
  .live-cell { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 0.75rem; min-width: 0; }
  .live-cell h3 { margin-bottom: 0.45rem; }
  .run-banner { font-size: 0.85rem; color: var(--muted); }
`;
}

function rubricSummary(scenario: ViewerCatalogScenario): string {
	const parts: string[] = [];
	const rubric = scenario.rubric;
	if (rubric.must?.length) {
		parts.push(`must ${rubric.must.join(", ")}`);
	}
	if (rubric.mustNot?.length) {
		parts.push(`must not ${rubric.mustNot.join(", ")}`);
	}
	if (rubric.mustRun?.length) {
		parts.push(`run ${rubric.mustRun.join(", ")}`);
	}
	if (rubric.allowedCommands) {
		parts.push(
			rubric.allowedCommands.length > 0
				? `allow ${rubric.allowedCommands.join(", ")}`
				: "allow no shell",
		);
	}
	if (rubric.mustCallTool?.length) {
		parts.push(`call ${rubric.mustCallTool.join(", ")}`);
	}
	if (rubric.mustReadPath?.length) {
		parts.push(`read ${rubric.mustReadPath.join(", ")}`);
	}
	if (rubric.mustInvokeSkill?.length) {
		parts.push(`skill ${rubric.mustInvokeSkill.join(", ")}`);
	}
	if (rubric.judge) {
		parts.push("judge");
	}
	return parts.join(" · ");
}

function renderScenarioRow(suite: ViewerCatalogSuite, scenario: ViewerCatalogScenario): string {
	const hosts = suite.hosts
		.map((host) => {
			const pinned = scenario.host && scenario.host !== host;
			const skipped = scenario.skip || pinned;
			return `<td data-cell="${escapeHtml(`${suite.name}::${scenario.name}::${host}`)}">
        <div class="cell-actions">
          <button class="primary run-cell" data-suite="${escapeHtml(suite.name)}" data-scenario="${escapeHtml(scenario.name)}" data-host="${escapeHtml(host)}"${skipped ? " disabled" : ""}>Run</button>
          <span class="cell-status muted">${skipped ? "skip" : "idle"}</span>
        </div>
      </td>`;
		})
		.join("");
	const compare = scenario.compare
		? scenario.compare
				.map(
					(arm) =>
						`<p class="arm-note">${escapeHtml(arm.label)}: ${escapeHtml(arm.description ?? arm.prompt ?? "")}</p>`,
				)
				.join("")
		: "";
	return `<tr>
    <th scope="row">
      <div class="scenario-detail">
        <strong>${escapeHtml(scenario.name)}</strong>
        ${scenario.description ? `<p class="scenario-lede">${escapeHtml(scenario.description)}</p>` : ""}
        <p class="prompt-preview">${escapeHtml(scenario.prompt)}</p>
        <p class="rubric-line">${escapeHtml(rubricSummary(scenario))}</p>
        ${compare}
        <button class="run-row" data-suite="${escapeHtml(suite.name)}" data-scenario="${escapeHtml(scenario.name)}">Run row</button>
      </div>
    </th>
    ${hosts}
  </tr>`;
}

function renderSuiteSection(suite: ViewerCatalogSuite): string {
	const columns = suite.hosts.map((host) => `<th>${escapeHtml(host)}</th>`).join("");
	const rows = suite.scenarios.map((scenario) => renderScenarioRow(suite, scenario)).join("");
	return `
<section class="suite" data-suite="${escapeHtml(suite.name)}">
  <header class="suite-header">
    <div class="suite-title">
      <h2>${escapeHtml(suite.name)}</h2>
      ${suite.description ? `<p class="muted">${escapeHtml(suite.description)}</p>` : ""}
    </div>
    <button class="run-suite" data-suite="${escapeHtml(suite.name)}">Run suite</button>
  </header>
  <table class="matrix">
    <thead><tr><th>Scenario</th>${columns}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function clientScript(): string {
	return `
(function () {
  var catalog = JSON.parse(document.getElementById("catalog-data").textContent);
  var source = null;
  var runId = null;

  function selectedHosts() {
    return Array.prototype.map.call(document.querySelectorAll("[data-host-toggle]:checked"), function (box) {
      return box.value;
    });
  }

  function parallelHosts() {
    return document.getElementById("parallel-hosts").checked;
  }

  function setRunBanner(text) {
    document.getElementById("run-banner").textContent = text;
  }

  function cellKey(event) {
    return [event.suite, event.scenario, event.host, event.arm || "_"].join("::");
  }

  function paneId(event) {
    return "live-" + cellKey(event).replace(/[^a-z0-9]+/gi, "-");
  }

  function ensurePane(event) {
    var id = paneId(event);
    var existing = document.getElementById(id);
    if (existing) {
      return existing.querySelector(".chat");
    }
    var dock = document.getElementById("live-dock");
    var article = document.createElement("article");
    article.className = "live-cell";
    article.id = id;
    var title = event.suite + " / " + event.scenario + " / " + event.host;
    if (event.arm) {
      title += " / arm " + event.arm;
    }
    article.innerHTML = "<h3></h3><div class=\\"chat\\"></div>";
    article.querySelector("h3").textContent = title;
    var parent = dock;
    if (event.arm) {
      var wrapId = ("live-wrap-" + event.suite + "-" + event.scenario + "-" + event.host).replace(/[^a-z0-9]+/gi, "-");
      var wrap = document.getElementById(wrapId);
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.className = "compare-layout";
        wrap.id = wrapId;
        var arms = document.createElement("div");
        arms.className = "compare-arms";
        wrap.appendChild(arms);
        dock.appendChild(wrap);
      }
      parent = wrap.querySelector(".compare-arms");
    }
    parent.appendChild(article);
    return article.querySelector(".chat");
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
        value.textContent = typeof args[key] === "string" ? args[key] : JSON.stringify(args[key]);
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

  function markCell(event, label, statusClass) {
    var selector = '[data-cell="' + event.suite + "::" + event.scenario + "::" + event.host + '"] .cell-status';
    document.querySelectorAll(selector).forEach(function (node) {
      node.textContent = label;
      node.className = "cell-status " + statusClass;
    });
  }

  function handleEvent(event) {
    if (event.type === "run_started") {
      setRunBanner("Run " + event.runId + " started.");
      document.getElementById("cancel-run").disabled = false;
      return;
    }
    if (event.type === "run_finished") {
      setRunBanner(
        "Run finished. " + event.passed + " passed. " + event.failed + " failed. " + event.skipped + " skipped."
      );
      document.getElementById("cancel-run").disabled = true;
      runId = null;
      return;
    }
    if (event.type === "error") {
      setRunBanner(event.message);
      return;
    }
    if (event.type === "cell_started") {
      markCell(event, "running", "status-skipped");
      ensurePane(event);
      return;
    }
    if (event.type === "prompt") {
      appendBubble(ensurePane(event), "user", event.text);
      return;
    }
    if (event.type === "text") {
      var key = cellKey(event);
      var chat = ensurePane(event);
      if (!assistantBodies[key]) {
        assistantBodies[key] = appendBubble(chat, "assistant", event.text);
      } else {
        assistantBodies[key].textContent = event.text;
      }
      return;
    }
    if (event.type === "tool") {
      assistantBodies[cellKey(event)] = null;
      appendTool(ensurePane(event), event.name, event.args);
      return;
    }
    if (event.type === "cell_finished") {
      markCell(event, event.skipped ? "skipped" : event.passed ? "passed" : "failed", event.skipped ? "status-skipped" : event.passed ? "status-passed" : "status-failed");
    }
  }

  async function startRun(body) {
    if (runId) {
      setRunBanner("A run is already in progress.");
      return;
    }
    var response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    var payload = await response.json();
    if (!response.ok) {
      setRunBanner(payload.error || "Run failed to start.");
      return;
    }
    runId = payload.runId;
    if (source) {
      source.close();
    }
    source = new EventSource("/api/runs/" + runId + "/events");
    source.onmessage = function (message) {
      handleEvent(JSON.parse(message.data));
    };
  }

  document.getElementById("run-selection").addEventListener("click", function () {
    startRun({ hosts: selectedHosts(), parallelHosts: parallelHosts() });
  });
  document.getElementById("cancel-run").addEventListener("click", function () {
    if (!runId) {
      return;
    }
    fetch("/api/runs/" + runId + "/cancel", { method: "POST" });
  });
  document.body.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) {
      return;
    }
    if (button.classList.contains("run-cell")) {
      startRun({
        suite: button.getAttribute("data-suite"),
        scenario: button.getAttribute("data-scenario"),
        hosts: [button.getAttribute("data-host")],
        parallelHosts: false,
      });
    }
    if (button.classList.contains("run-row")) {
      startRun({
        suite: button.getAttribute("data-suite"),
        scenario: button.getAttribute("data-scenario"),
        hosts: selectedHosts(),
        parallelHosts: parallelHosts(),
      });
    }
    if (button.classList.contains("run-suite")) {
      startRun({
        suite: button.getAttribute("data-suite"),
        hosts: selectedHosts(),
        parallelHosts: parallelHosts(),
      });
    }
  });
})();
`;
}

export function renderViewerPage(catalog: ViewerCatalog): string {
	const hostToggles = Array.from(new Set(catalog.suites.flatMap((suite) => suite.hosts)))
		.map((host) => {
			const checked = catalog.defaultSelectedHosts.includes(host) ? " checked" : "";
			return `<label><input type="checkbox" data-host-toggle value="${escapeHtml(host)}"${checked}>${escapeHtml(host)}</label>`;
		})
		.join("");
	const suites = catalog.suites.map(renderSuiteSection).join("\n");
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>agent-test viewer</title>
  <style>
${reportCss()}
${viewerCss()}
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <p class="brand">agent-test</p>
      <h1>Suite viewer</h1>
      <p class="lede">This page lists every scenario before a run.</p>
      <p class="warn">Run starts a live host agent.</p>
    </header>
    <section class="toolbar">
      <div class="toolbar-block">
        <p class="toolbar-label">Hosts</p>
        <div class="host-toggles">${hostToggles}</div>
      </div>
      <div class="toolbar-block">
        <p class="toolbar-label">Matrix</p>
        <label><input type="checkbox" id="parallel-hosts"> Run hosts together</label>
      </div>
      <div class="toolbar-actions">
        <button class="primary" id="run-selection">Run selection</button>
        <button class="danger" id="cancel-run" disabled>Cancel run</button>
      </div>
      <p class="run-banner" id="run-banner"></p>
    </section>
    ${suites}
    <section class="live-dock" id="live-dock"></section>
  </main>
  <script type="application/json" id="catalog-data">${embedJson(catalog)}</script>
  <script>
${clientScript()}
  </script>
</body>
</html>
`;
}
