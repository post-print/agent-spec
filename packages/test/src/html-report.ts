import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
	AgentMessage,
	AgentToolCall,
	AgentTrace,
	AgentUsage,
} from "@post-print/agent-harness";

import { compareResultArms, describeCompareOutcome } from "./compare-scenario.js";
import { summarizeReports } from "./suite-summary.js";
import type { CompareArmResult, ScenarioResult, SuiteRunReport, UsageStats } from "./types.js";

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

const INTEGER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DECIMAL_FORMAT = new Intl.NumberFormat("en-US", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

function formatInteger(value: number): string {
	return INTEGER_FORMAT.format(Math.round(value));
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${formatInteger(ms)}ms`;
	}
	return `${DECIMAL_FORMAT.format(ms / 1000)}s`;
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

const MISSING_REQUIREMENT = {
	label: "Missing requirement",
	hint: "A required string did not appear in assistant text, commands, or tool results.",
};
const FORBIDDEN_BEHAVIOR = {
	label: "Forbidden behavior",
	hint: "The agent did something it was told not to do.",
};
const MISSING_COMMAND = {
	label: "Missing command",
	hint: "An expected command never ran.",
};
const MISSING_TOOL = {
	label: "Missing tool call",
	hint: "An expected tool was never invoked.",
};
const FORBIDDEN_TOOL = {
	label: "Forbidden tool call",
	hint: "A tool the scenario forbids was invoked.",
};
const MISSING_SKILL = {
	label: "Missing skill",
	hint: "The agent did not read a skill it was expected to use.",
};
const UNEXPECTED_SKILL = {
	label: "Unexpected skill",
	hint: "The agent read a skill it should have avoided.",
};
const MISSING_READ_PATH = {
	label: "Missing read path",
	hint: "Expected a Read tool call whose args mention this path fragment (registry-first / grounding).",
};
const FORBIDDEN_READ_PATH = {
	label: "Forbidden read path",
	hint: "A successful Read returned content from a path the scenario forbids (miss attempts do not fail).",
};
const ROUTING = {
	label: "Routing",
	hint: "The routing announcement did not match expectations.",
};

/** Human-readable label + one-line explanation for the matcher codes assertRubric/judge emit. */
const MATCHER_LABELS: Record<string, { label: string; hint?: string }> = {
	runAgent: { label: "Agent run", hint: "The agent session itself failed or was cut short." },
	liveScenario: {
		label: "Isolated scenario",
		hint: "The scenario subprocess exited before it wrote a result.",
	},
	must: MISSING_REQUIREMENT,
	mustInclude: MISSING_REQUIREMENT,
	mustNot: FORBIDDEN_BEHAVIOR,
	mustNotInclude: FORBIDDEN_BEHAVIOR,
	mustRun: MISSING_COMMAND,
	toHaveRunCommand: MISSING_COMMAND,
	mustCallTool: MISSING_TOOL,
	toHaveCalledTool: MISSING_TOOL,
	mustNotCallTool: FORBIDDEN_TOOL,
	toHaveNotCalledTool: FORBIDDEN_TOOL,
	mustInvokeSkill: MISSING_SKILL,
	toHaveInvokedSkill: MISSING_SKILL,
	mustNotInvokeSkill: UNEXPECTED_SKILL,
	toHaveNotInvokedSkill: UNEXPECTED_SKILL,
	mustReadPath: MISSING_READ_PATH,
	toHaveReadPath: MISSING_READ_PATH,
	mustNotReadPath: FORBIDDEN_READ_PATH,
	toHaveNotReadPath: FORBIDDEN_READ_PATH,
	routingBlock: ROUTING,
	toIncludeRoutingBlock: ROUTING,
	toHaveRoutingBlockBeforeTools: ROUTING,
	toHaveTier: ROUTING,
	toHaveHandsOnTier: ROUTING,
	toHaveHandsOnTierBeforeTools: ROUTING,
	toHaveReviewDepth: {
		label: "Review depth",
		hint: "The review depth announcement did not match the rubric.",
	},
	workingTreeLeak: {
		label: "Working tree leak",
		hint: "The agent used a path outside the sealed workspace, or edited the caller checkout.",
	},
	recordTrace: { label: "Recording failed", hint: "Saving the trace to disk failed." },
	judge: { label: "Judge", hint: "The LLM judge flagged this scenario." },
	faster: {
		label: "Faster arm",
		hint: "The named arm must finish in less time.",
	},
	cheaper: {
		label: "Cheaper arm",
		hint: "The named arm must use fewer tokens.",
	},
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

function promptAlreadyInTrace(trace: AgentTrace | undefined, prompt: string): boolean {
	return (
		trace?.messages.some(
			(message) => message.role === "user" && message.content.trim() === prompt,
		) ?? false
	);
}

function renderPromptBubble(prompt: string | undefined, trace: AgentTrace | undefined): string {
	const text = prompt?.trim();
	if (!text || promptAlreadyInTrace(trace, text)) {
		return "";
	}
	return renderMessageBubble({ role: "user", content: text });
}

function renderChat(trace: AgentTrace | undefined, prompt?: string): string {
	const promptBubble = renderPromptBubble(prompt, trace);
	if (!trace) {
		if (promptBubble) {
			return `<div class="chat">${promptBubble}</div>`;
		}
		return `<p class="empty">No transcript recorded for this scenario.</p>`;
	}

	const parts: string[] = [];
	const timeline = buildOrderedTimeline(trace);

	if (timeline) {
		parts.push(`<div class="chat">`);
		if (promptBubble) {
			parts.push(promptBubble);
		}
		for (const item of timeline) {
			parts.push(
				item.kind === "message" ? renderMessageBubble(item.message) : renderToolCallCard(item.call),
			);
		}
		parts.push(`</div>`);
	} else if (trace.messages.length > 0 || trace.toolCalls.length > 0 || promptBubble) {
		if (!timeline && (trace.messages.length > 0 || trace.toolCalls.length > 0)) {
			parts.push(
				`<p class="empty note">Emission order wasn't recorded for this trace — messages and tool calls are shown in separate groups below.</p>`,
			);
		}
		if (promptBubble || trace.messages.length > 0) {
			parts.push(`<div class="chat">`);
			if (promptBubble) {
				parts.push(promptBubble);
			}
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
			const evidence = failure.evidence
				? `<pre class="failure-evidence">${escapeHtml(failure.evidence)}</pre>`
				: "";
			return `
<li>
  <p class="failure-label">${escapeHtml(label)}</p>
  ${hint ? `<p class="failure-hint">${escapeHtml(hint)}</p>` : ""}
  <p class="failure-message">${escapeHtml(failure.message)}</p>
  ${evidence}
</li>`;
		})
		.join("\n");

	return `<ul class="failures">${items}</ul>`;
}

function usageOf(result: ScenarioResult): AgentUsage | undefined {
	return result.usage?.total ?? result.trace?.usage;
}

function formatTokensBadge(result: ScenarioResult): string | undefined {
	const usage = usageOf(result);
	if (!usage) {
		return undefined;
	}
	if (typeof usage.totalTokens === "number") {
		return `${formatInteger(usage.totalTokens)} tokens`;
	}
	const parts: string[] = [];
	if (typeof usage.inputTokens === "number") {
		parts.push(`in ${formatInteger(usage.inputTokens)}`);
	}
	if (typeof usage.outputTokens === "number") {
		parts.push(`out ${formatInteger(usage.outputTokens)}`);
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function renderUsageDetail(usage: AgentUsage | undefined): string {
	if (!usage) {
		return "";
	}
	const rows: Array<[string, number | undefined]> = [
		["Total tokens", usage.totalTokens],
		["Input", usage.inputTokens],
		["Output", usage.outputTokens],
		["Cache read", usage.cacheReadTokens],
		["Cache write", usage.cacheWriteTokens],
		["Reasoning", usage.reasoningTokens],
	];
	const present = rows.filter(([, value]) => typeof value === "number");
	if (present.length === 0) {
		return "";
	}
	const items = present
		.map(
			([label, value]) =>
				`<div class="meta-item"><span class="meta-key">${escapeHtml(label)}</span><span class="meta-val">${formatInteger(value ?? 0)}</span></div>`,
		)
		.join("");
	return `<section class="scenario-meta"><h3>Token usage</h3><div class="meta-grid">${items}</div></section>`;
}

function renderTraceMeta(result: ScenarioResult): string {
	const trace = result.trace;
	if (!trace) {
		return "";
	}
	const skills = trace.skillsInvoked?.length ? trace.skillsInvoked.join(", ") : "(none)";
	const items: Array<[string, string]> = [
		["Messages", formatInteger(trace.messages.length)],
		["Tool calls", formatInteger(trace.toolCalls.length)],
		["Skills invoked", skills],
		["Routing tier", trace.routing?.tier ?? "(none)"],
	];
	if (result.attempts !== undefined && result.attempts > 1) {
		items.push(["Attempts", formatInteger(result.attempts)]);
	}
	const html = items
		.map(
			([label, value]) =>
				`<div class="meta-item"><span class="meta-key">${escapeHtml(label)}</span><span class="meta-val">${escapeHtml(value)}</span></div>`,
		)
		.join("");
	return `<section class="scenario-meta"><h3>Trace stats</h3><div class="meta-grid">${html}</div></section>`;
}

function costItem(label: string, detail: string, value: string): string {
	return `<div class="cost-item"><span class="cost-value">${escapeHtml(value)}</span><span class="cost-label">${escapeHtml(label)}</span><span class="cost-detail">${escapeHtml(detail)}</span></div>`;
}

function renderCostSection(usage: UsageStats | undefined): string {
	if (!usage || usage.sumTotalTokens === undefined) {
		return "";
	}
	const items = [costItem("Total", "Cost of this run", formatInteger(usage.sumTotalTokens))];
	if (usage.sumInputTokens !== undefined) {
		items.push(
			costItem("In", "Prompt and context the host sent", formatInteger(usage.sumInputTokens)),
		);
	}
	if (usage.sumOutputTokens !== undefined) {
		items.push(costItem("Out", "Text the agent wrote", formatInteger(usage.sumOutputTokens)));
	}
	if (usage.scenariosWithUsage > 1 && usage.p50TotalTokens !== undefined) {
		items.push(
			costItem(
				"Typical",
				"Middle scenario. Half cost less than this.",
				formatInteger(usage.p50TotalTokens),
			),
		);
	}
	if (usage.scenariosWithUsage > 1 && usage.maxTotalTokens !== undefined) {
		items.push(costItem("Largest", "Heaviest scenario", formatInteger(usage.maxTotalTokens)));
	}
	return `<section class="cost" aria-labelledby="cost-heading">
  <h2 id="cost-heading">Token cost</h2>
  <p class="cost-lede">Tokens are cost, not the verdict. Pass and fail sit on each scenario.</p>
  <div class="cost-grid">${items.join("")}</div>
</section>`;
}

function formatSigned(value: number | undefined): string {
	if (value === undefined) {
		return "n/a";
	}
	if (value > 0) {
		return `+${formatInteger(value)}`;
	}
	if (value < 0) {
		return `-${formatInteger(Math.abs(value))}`;
	}
	return formatInteger(value);
}

function formatSignedDuration(deltaMs: number | undefined): string {
	if (deltaMs === undefined) {
		return "n/a";
	}
	if (deltaMs === 0) {
		return formatDuration(0);
	}
	const sign = deltaMs > 0 ? "+" : "-";
	return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

function deltaClass(value: number | undefined): string {
	if (value === undefined || value === 0) {
		return "delta-flat";
	}
	return value > 0 ? "delta-up" : "delta-down";
}

function armDurationMs(arm: CompareArmResult): number | undefined {
	return typeof arm.durationMs === "number" ? arm.durationMs : undefined;
}

function armToolCount(arm: CompareArmResult): number | undefined {
	return arm.trace ? arm.trace.toolCalls.length : undefined;
}

function formatArmDuration(arm: CompareArmResult): string {
	const ms = armDurationMs(arm);
	return ms === undefined ? "n/a" : formatDuration(ms);
}

function formatArmTokens(arm: CompareArmResult, key: "total" | "input" | "output"): string {
	const usage = arm.trace?.usage;
	const value =
		key === "total"
			? usage?.totalTokens
			: key === "input"
				? usage?.inputTokens
				: usage?.outputTokens;
	return typeof value === "number" ? formatInteger(value) : "n/a";
}

function tokenDelta(
	a: CompareArmResult,
	b: CompareArmResult,
	key: "total" | "input" | "output",
): number | undefined {
	const pick = (arm: CompareArmResult) => {
		const usage = arm.trace?.usage;
		return key === "total"
			? usage?.totalTokens
			: key === "input"
				? usage?.inputTokens
				: usage?.outputTokens;
	};
	const aValue = pick(a);
	const bValue = pick(b);
	if (typeof aValue !== "number" || typeof bValue !== "number") {
		return undefined;
	}
	return bValue - aValue;
}

function winnerCellClass(delta: number | undefined, side: "a" | "b"): string {
	if (delta === undefined || delta === 0) {
		return "";
	}
	if (side === "a") {
		return delta > 0 ? "is-better" : "is-worse";
	}
	return delta < 0 ? "is-better" : "is-worse";
}

function renderCompareMetricRow(
	label: string,
	aText: string,
	bText: string,
	delta: number | undefined,
	deltaText: string,
): string {
	return `<tr>
  <th scope="row">${escapeHtml(label)}</th>
  <td class="${winnerCellClass(delta, "a")}">${escapeHtml(aText)}</td>
  <td class="${winnerCellClass(delta, "b")}">${escapeHtml(bText)}</td>
  <td class="${deltaClass(delta)}">${escapeHtml(deltaText)}</td>
</tr>`;
}

function renderNamedCompareMetricRow(label: string, cells: string[]): string {
	return `<tr>
  <th scope="row">${escapeHtml(label)}</th>
  ${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
</tr>`;
}

function renderTwoArmCompareMetrics(arms: [CompareArmResult, CompareArmResult]): string {
	const [left, right] = arms;
	const aMs = armDurationMs(left);
	const bMs = armDurationMs(right);
	const durationDelta = aMs !== undefined && bMs !== undefined ? bMs - aMs : undefined;
	const aTools = armToolCount(left);
	const bTools = armToolCount(right);
	const toolDelta = aTools !== undefined && bTools !== undefined ? bTools - aTools : undefined;
	const totalDelta = tokenDelta(left, right, "total");
	return `
  <div class="compare-table-wrap">
    <table class="compare-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>${escapeHtml(left.label)}</th>
          <th>${escapeHtml(right.label)}</th>
          <th>Δ</th>
        </tr>
      </thead>
      <tbody>
        ${renderCompareMetricRow("Duration", formatArmDuration(left), formatArmDuration(right), durationDelta, formatSignedDuration(durationDelta))}
        ${renderCompareMetricRow("Tokens", formatArmTokens(left, "total"), formatArmTokens(right, "total"), totalDelta, formatSigned(totalDelta))}
        ${renderCompareMetricRow("In", formatArmTokens(left, "input"), formatArmTokens(right, "input"), tokenDelta(left, right, "input"), formatSigned(tokenDelta(left, right, "input")))}
        ${renderCompareMetricRow("Out", formatArmTokens(left, "output"), formatArmTokens(right, "output"), tokenDelta(left, right, "output"), formatSigned(tokenDelta(left, right, "output")))}
        ${renderCompareMetricRow("Tools", aTools === undefined ? "n/a" : formatInteger(aTools), bTools === undefined ? "n/a" : formatInteger(bTools), toolDelta, formatSigned(toolDelta))}
      </tbody>
    </table>
  </div>`;
}

function renderNamedCompareMetrics(arms: CompareArmResult[]): string {
	return `
  <div class="compare-table-wrap">
    <table class="compare-table">
      <thead>
        <tr>
          <th>Metric</th>
          ${arms.map((arm) => `<th>${escapeHtml(arm.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${renderNamedCompareMetricRow(
					"Duration",
					arms.map((arm) => formatArmDuration(arm)),
				)}
        ${renderNamedCompareMetricRow(
					"Tokens",
					arms.map((arm) => formatArmTokens(arm, "total")),
				)}
        ${renderNamedCompareMetricRow(
					"In",
					arms.map((arm) => formatArmTokens(arm, "input")),
				)}
        ${renderNamedCompareMetricRow(
					"Out",
					arms.map((arm) => formatArmTokens(arm, "output")),
				)}
        ${renderNamedCompareMetricRow(
					"Tools",
					arms.map((arm) => {
						const tools = armToolCount(arm);
						return tools === undefined ? "n/a" : formatInteger(tools);
					}),
				)}
      </tbody>
    </table>
  </div>`;
}

function renderCompareMetrics(result: ScenarioResult): string {
	const compare = result.compare;
	if (!compare) {
		return "";
	}
	const arms = compareResultArms(compare);
	if (arms.length === 0) {
		return "";
	}
	const callouts = describeCompareOutcome(compare);
	const calloutList =
		callouts.length > 0
			? `<ul class="compare-callouts">${callouts.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
			: "";
	const twoArm = arms.length === 2 && arms[0] && arms[1];
	const lede = twoArm
		? `${arms[0].label} vs ${arms[1].label}. Δ is B minus A. A lower time and a lower token count is better.`
		: `${arms.map((arm) => arm.label).join(", ")}. A lower time and a lower token count is better. Named pairs do not pick one winner.`;
	return `
<section class="compare">
  <header class="compare-header">
    <h3>Comparison</h3>
    <p class="muted">${escapeHtml(lede)}</p>
  </header>
  ${calloutList}
  ${twoArm ? renderTwoArmCompareMetrics([arms[0], arms[1]]) : renderNamedCompareMetrics(arms)}
</section>`;
}

function renderArmMetrics(arm: CompareArmResult): string {
	const parts: string[] = [];
	const ms = armDurationMs(arm);
	if (ms !== undefined) {
		parts.push(formatDuration(ms));
	}
	const tokens = formatArmTokens(arm, "total");
	if (tokens !== "n/a") {
		parts.push(`${tokens} tokens`);
	}
	const tools = armToolCount(arm);
	if (tools !== undefined) {
		parts.push(tools === 1 ? "1 tool" : `${formatInteger(tools)} tools`);
	}
	if (parts.length === 0) {
		return "";
	}
	return `<p class="compare-arm-metrics">${escapeHtml(parts.join(" · "))}</p>`;
}

function renderArmColumn(arm: CompareArmResult, index: number): string {
	const description = arm.description
		? `<p class="compare-arm-description">${escapeHtml(arm.description)}</p>`
		: "";
	const sideClass = arm.id === "a" || arm.id === "b" ? ` compare-arm-${arm.id}` : "";
	const kicker = arm.id === "a" ? "Arm A" : arm.id === "b" ? "Arm B" : `Arm ${arm.id}`;
	return `
<article class="compare-arm${sideClass}" style="--arm-accent: var(--arm-${index % 4});">
  <header class="compare-arm-header">
    <p class="compare-arm-kicker">${escapeHtml(kicker)}</p>
    <h3>${escapeHtml(arm.label)}</h3>
    ${description}
    ${renderArmMetrics(arm)}
  </header>
  ${renderChat(arm.trace, arm.prompt)}
</article>`;
}

function renderCompareConversations(result: ScenarioResult): string {
	const compare = result.compare;
	if (!compare) {
		return `<section class="conversation">
    <h3>Conversation</h3>
    ${renderChat(result.trace, result.prompt)}
  </section>`;
	}
	const arms = compareResultArms(compare);
	return `
<div class="compare-layout">
  <div class="compare-arms" data-arm-count="${arms.length}">
    ${arms.map((arm, index) => renderArmColumn(arm, index)).join("")}
  </div>
  ${renderCompareMetrics(result)}
</div>`;
}

function renderStoryList(title: string, lines: string[] | undefined): string {
	if (!lines || lines.length === 0) {
		return "";
	}
	const items = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
	return `<section class="story-block"><h3>${escapeHtml(title)}</h3><ul class="story-list">${items}</ul></section>`;
}

function renderStory(result: ScenarioResult): string {
	const story = result.story;
	if (!story) {
		return "";
	}
	return `<div class="story">
    ${renderStoryList("Criteria", story.criteria)}
    ${renderStoryList("Result", [...story.result, ...story.verdict])}
  </div>`;
}

function renderScenario(result: ScenarioResult): string {
	const open = result.skipped ? "" : !result.passed || result.compare ? " open" : "";
	const failures = result.story ? "" : renderFailures(result);
	const judgeVerdicts = renderJudgeVerdicts(result);
	const tokens = formatTokensBadge(result);
	const usageDetail = result.compare ? "" : renderUsageDetail(usageOf(result));
	const traceMeta = result.compare ? "" : renderTraceMeta(result);
	const story = renderStory(result);
	const diagnostics =
		story || failures || judgeVerdicts
			? `<div class="diagnostics">
    ${story}
    ${failures ? `<section><h3>What went wrong</h3>${failures}</section>` : ""}
    ${judgeVerdicts ? `<section><h3>Judge verdict</h3>${judgeVerdicts}</section>` : ""}
  </div>`
			: "";
	const metaRow =
		usageDetail || traceMeta
			? `<div class="diagnostics meta-row">${usageDetail}${traceMeta}</div>`
			: "";
	const compareClass = result.compare ? " compare-scenario" : "";
	const description = result.description
		? `<span class="scenario-lede">${escapeHtml(result.description)}</span>`
		: "";
	return `
<details class="scenario ${statusClass(result)}${compareClass}"${open}>
  <summary>
    <span class="badge ${statusClass(result)}">${statusLabel(result)}</span>
    <span class="scenario-heading">
      <span class="scenario-name">${escapeHtml(result.scenario)}</span>
      ${description}
    </span>
    ${tokens ? `<span class="tokens">${escapeHtml(tokens)}</span>` : ""}
    <span class="duration">${escapeHtml(formatDuration(result.durationMs))}</span>
  </summary>
  <div class="scenario-body">
  ${diagnostics}
  ${metaRow}
  ${renderCompareConversations(result)}
  </div>
</details>`;
}

function renderSuite(report: SuiteRunReport): string {
	const scenarios = report.results.map(renderScenario).join("\n");
	return `
<section class="suite">
  <header class="suite-header">
    <div class="suite-title">
      <h2>${escapeHtml(report.suite)}</h2>
      <span class="host">${escapeHtml(report.host)}</span>
    </div>
    <p class="suite-counts"><span>${formatInteger(report.passed)} passed</span><span>${formatInteger(report.failed)} failed</span><span>${formatInteger(report.skipped)} skipped</span></p>
  </header>
  ${scenarios}
</section>`;
}

function sharedReportCss(): string {
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
      word-spacing: 0.16em;
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
    .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 0.7rem; margin-bottom: 0.9rem; }
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
  .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0.7rem; margin-bottom: 0.9rem; }
  .diagnostics section { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 0.7rem; min-width: 0; }
  .conversation { min-width: 0; }

  .story { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.85rem; margin-bottom: 0.85rem; }
  .story-block h3 { margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .story-list { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; color: var(--text); }
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

  .compare-layout {
    container-type: inline-size;
    display: grid;
    gap: 0.9rem;
  }
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
  .compare-header h3 { margin-bottom: 0.2rem; }
  .compare-callouts {
    margin: 0 0 0.75rem;
    padding-left: 1.1rem;
    display: grid;
    gap: 0.25rem;
    font-size: 0.85rem;
  }
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
  .is-better { color: var(--pass); font-weight: 650; }
  .is-worse { color: var(--muted); }

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

/** Build a self-contained HTML report for a completed suite run. */
export function renderHtmlReport(reports: SuiteRunReport[], meta: HtmlReportMeta = {}): string {
	const generatedAt = meta.generatedAt ?? new Date();
	const totalPassed = reports.reduce((sum, report) => sum + report.passed, 0);
	const totalFailed = reports.reduce((sum, report) => sum + report.failed, 0);
	const totalSkipped = reports.reduce((sum, report) => sum + report.skipped, 0);
	const hostNames = [...new Set(reports.map((report) => report.host).filter(Boolean))];
	const host = meta.host ?? (hostNames.length > 0 ? hostNames.join(", ") : "unknown");
	const runUsage = summarizeReports(reports).usage;

	const suitesHtml = reports.map(renderSuite).join("\n");

	const suiteWord = reports.length === 1 ? "suite" : "suites";
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>agent-test report</title>
<style>${sharedReportCss()}</style>
</head>
<body>
<main>
  <header class="report-header">
    <p class="brand">agent-test</p>
    <h1>Run report</h1>
    <p class="lede">${escapeHtml(String(host))} · ${formatInteger(reports.length)} ${suiteWord}${meta.suitesDir ? ` · ${escapeHtml(meta.suitesDir)}` : ""}</p>
  </header>
  <section class="summary" aria-label="Run verdict">
    <div class="stats">
      <span class="stat stat-pass"><strong>${formatInteger(totalPassed)}</strong><span>passed</span></span>
      <span class="stat stat-fail"><strong>${formatInteger(totalFailed)}</strong><span>failed</span></span>
      <span class="stat stat-skip"><strong>${formatInteger(totalSkipped)}</strong><span>skipped</span></span>
    </div>
    <p class="when">Generated ${escapeHtml(generatedAt.toISOString())}</p>
  </section>
  <section class="guide" aria-labelledby="guide-heading">
    <h2 id="guide-heading">How to read this report</h2>
    <ol>
      <li>The verdict is pass or fail. Tokens are cost, not the score.</li>
      <li>Open a scenario for the criteria and the result. A compare scenario shows each arm, then time, tokens, and tools.</li>
      <li>Typical is the middle scenario cost. Largest is the heaviest scenario.</li>
      <li>In is prompt and context. Out is generated text.</li>
    </ol>
  </section>
  ${renderCostSection(runUsage)}
  ${suitesHtml}
</main>
</body>
</html>
`;
}

/**
 * Write an HTML report. Writes to `outPath` when given (parent dirs created),
 * otherwise a fresh temp directory. Returns the report file path.
 */
export async function writeHtmlReport(
	reports: SuiteRunReport[],
	meta: HtmlReportMeta = {},
	outPath?: string,
): Promise<string> {
	const path = outPath ?? join(await mkdtemp(join(tmpdir(), "agent-test-report-")), "report.html");
	if (outPath) {
		await mkdir(dirname(outPath), { recursive: true });
	}
	const html = renderHtmlReport(reports, meta);
	await writeFile(path, html, "utf8");
	return path;
}
