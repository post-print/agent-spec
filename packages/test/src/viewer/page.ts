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
    margin: 0 0 0.25rem;
  }
  .context-why {
    color: var(--muted);
    font-size: 0.8rem;
    margin: 0 0 0.45rem;
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
	if (scenario.contextSources?.length) {
		parts.push(`contextSources ${scenario.contextSources.join(", ")}`);
	}
	return parts.join(" · ");
}

function defaultScenarioHost(suite: ViewerCatalogSuite, scenario: ViewerCatalogScenario): string {
	if (scenario.host && suite.hosts.includes(scenario.host)) {
		return scenario.host;
	}
	if (suite.hosts.includes("cursor")) {
		return "cursor";
	}
	return suite.hosts[0] ?? "cursor";
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
	return `<div class="host-tablist" role="tablist">${tabs}</div>`;
}

function renderHostPanels(suite: ViewerCatalogSuite, selectedHost: string): string {
	return suite.hosts
		.map((host) => {
			const selected = host === selectedHost;
			return `<div class="host-panel" data-host-panel="${escapeHtml(host)}" role="tabpanel"${selected ? "" : " hidden"}><p class="host-empty">No run yet.</p></div>`;
		})
		.join("");
}

function renderScenarioCard(suite: ViewerCatalogSuite, scenario: ViewerCatalogScenario): string {
	const selectedHost = defaultScenarioHost(suite, scenario);
	const runDisabled = hostIsSkipped(scenario, selectedHost);
	const compare = scenario.compare
		? scenario.compare
				.map(
					(arm) =>
						`<p class="arm-note">${escapeHtml(arm.label)}: ${escapeHtml(arm.description ?? arm.prompt ?? "")}</p>`,
				)
				.join("")
		: "";
	const key = escapeHtml(`${suite.name}::${scenario.name}`);
	return `<article class="scenario-card" data-scenario-card="${key}">
    <div class="scenario-detail">
      <strong>${escapeHtml(scenario.name)}</strong>
      ${scenario.description ? `<p class="scenario-lede">${escapeHtml(scenario.description)}</p>` : ""}
      <p class="prompt-preview">${escapeHtml(scenario.prompt)}</p>
      <p class="rubric-line">${escapeHtml(rubricSummary(scenario))}</p>
      ${compare}
    </div>
    <div class="scenario-toolbar">
      ${renderHostChrome(suite, scenario, selectedHost)}
      <div class="scenario-actions">
        <button class="primary run-cell" data-suite="${escapeHtml(suite.name)}" data-scenario="${escapeHtml(scenario.name)}" data-host="${escapeHtml(selectedHost)}"${runDisabled ? " disabled" : ""}>Run</button>
        <button class="run-row" data-suite="${escapeHtml(suite.name)}" data-scenario="${escapeHtml(scenario.name)}"${scenario.skip ? " disabled" : ""}>Run selected hosts</button>
      </div>
    </div>
    <div class="scenario-live" hidden data-live-row="${key}" data-live-slot="${key}">
      <div class="host-panels">${renderHostPanels(suite, selectedHost)}</div>
    </div>
  </article>`;
}

function renderSuiteSection(suite: ViewerCatalogSuite): string {
	const cards = suite.scenarios.map((scenario) => renderScenarioCard(suite, scenario)).join("");
	return `
<section class="suite" data-suite="${escapeHtml(suite.name)}">
  <header class="suite-header">
    <div class="suite-title">
      <h2>${escapeHtml(suite.name)}</h2>
      ${suite.description ? `<p class="muted">${escapeHtml(suite.description)}</p>` : ""}
    </div>
    <button class="run-suite" data-suite="${escapeHtml(suite.name)}">Run suite</button>
  </header>
  <div class="scenario-list">${cards}</div>
</section>`;
}

function clientScript(): string {
	return `
(function () {
  var catalog = JSON.parse(document.getElementById("catalog-data").textContent);
  var source = null;
  var runId = null;
  var cancelRequested = false;
  var progress = { total: 0, completed: 0, passed: 0, failed: 0, skipped: 0, seen: {}, experiments: {} };

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

  function runnableTargets(body) {
    var requestedHosts = body.hosts && body.hosts.length ? body.hosts : catalog.defaultSelectedHosts;
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

  function setCancelButton(label, disabled) {
    var button = document.getElementById("cancel-run");
    button.textContent = label;
    button.disabled = disabled;
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

  function appendContextFiles(chat, files) {
    (files || []).forEach(function (file) {
      var row = document.createElement("div");
      row.className = "chat-row side-left";
      var bubble = document.createElement("div");
      bubble.className = "bubble role-context";
      var label = document.createElement("div");
      label.className = "bubble-label";
      label.textContent = "Context";
      var path = document.createElement("p");
      path.className = "context-path";
      path.textContent = file.path || "context";
      var why = document.createElement("p");
      why.className = "context-why";
      why.textContent = file.why || "The runner loaded this file into the host preamble.";
      var body = document.createElement("div");
      body.className = "bubble-text";
      body.textContent = file.text || "";
      bubble.appendChild(label);
      bubble.appendChild(path);
      bubble.appendChild(why);
      bubble.appendChild(body);
      row.appendChild(bubble);
      chat.appendChild(row);
    });
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
      return { passed: passed, line: winner.label + " must beat " + loser.label + " on " + gate.metric + " (" + winnerValue + " vs " + loserValue + "). " + (passed ? "Pass." : "Fail.") };
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
	  summarizeMetric(rows, "durationMs", "Duration"),
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
      setCancelButton("Cancel run", false);
      return;
    }
    if (event.type === "run_finished") {
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
      setCancelButton("Cancel run", true);
      cancelRequested = false;
      runId = null;
      if (source) {
        source.close();
        source = null;
      }
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
        appendContextFiles(contextChat, event.files);
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
    var hosts = body.hosts && body.hosts.length ? body.hosts : catalog.defaultSelectedHosts;
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
    if (runId) {
      setRunBanner(
        cancelRequested
          ? "Cancelling the run. Wait for it to stop."
          : "A run is already in progress. Cancel it first."
      );
      return;
    }
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
        return;
      }
      runId = payload.runId;
      cancelRequested = false;
      setRunBanner("Run " + runId + " started.");
      setCancelButton("Cancel run", false);
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
    }
  }

  document.getElementById("run-selection").addEventListener("click", function () {
    startRun({ hosts: selectedHosts(), parallelHosts: parallelHosts() });
  });
  document.getElementById("cancel-run").addEventListener("click", function () {
    if (!runId || cancelRequested) {
      return;
    }
    cancelRequested = true;
    setRunBanner("Cancelling the run.");
    setCancelButton("Cancelling", true);
    cancelOpenChats();
    fetch("/api/runs/" + runId + "/cancel", { method: "POST" }).then(function (response) {
      if (!response.ok && cancelRequested) {
        setRunBanner("Cancel failed.");
        setCancelButton("Cancel run", false);
        cancelRequested = false;
      }
    }).catch(function () {
      if (cancelRequested) {
        setRunBanner("Cancel failed.");
        setCancelButton("Cancel run", false);
        cancelRequested = false;
      }
    });
  });
  document.body.addEventListener("click", function (event) {
    var button = event.target.closest("button");
    if (!button) {
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
        <p class="toolbar-label">Run order</p>
        <label><input type="checkbox" id="parallel-hosts"> Run hosts together</label>
      </div>
      <div class="toolbar-actions">
        <button class="primary" id="run-selection">Run selection</button>
        <button class="danger" id="cancel-run" disabled>Cancel run</button>
      </div>
      <p class="run-banner" id="run-banner"></p>
    </section>
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
    ${suites}
  </main>
  <script type="application/json" id="catalog-data">${embedJson(catalog)}</script>
  <script>
${clientScript()}
  </script>
</body>
</html>
`;
}
