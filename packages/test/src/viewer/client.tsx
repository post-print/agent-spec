import type { AgentTrace, AgentUsage } from "@post-print/agent-harness";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type {
	CompareArmResult,
	CompareGate,
	JudgeVerdictResult,
	ScenarioCompareResult,
	ScenarioResult,
	ScenarioRubric,
	StoryCheck,
	SuiteRunReport,
} from "../types.js";
import type {
	ViewerCatalog,
	ViewerCatalogScenario,
	ViewerCatalogSuite,
	ViewerRunRequest,
} from "./catalog.js";
import type {
	ViewerBootstrap,
	ViewerEvent,
	ViewerJudgeVerdictEvent,
	ViewerRunRecord,
} from "./events.js";
import { TabList } from "./tabs.js";

type Status =
	| "queued"
	| "judging"
	| "awaiting comparison"
	| "idle"
	| "running"
	| "cancelling"
	| "cancelled"
	| "passed"
	| "failed"
	| "skipped";

type LiveItem =
	| { kind: "message"; role: "user" | "assistant" | "system"; text: string; streaming?: boolean }
	| { kind: "tool"; name: string; args?: Record<string, unknown> };

interface LiveCell {
	status: Status;
	statuses: string[];
	items: LiveItem[];
	result?: ScenarioResult;
	provisional?: boolean;
	durationMs?: number;
	tokens?: number;
	judge?: {
		status: "running" | "completed";
		id: string;
		question: string;
		text: string;
		verdicts: ViewerJudgeVerdictEvent[];
	};
}

interface CriteriaTarget {
	rubric: ScenarioRubric;
	contextMode?: ViewerCatalogScenario["contextMode"];
	workspace?: string;
	contextSources?: string[];
	suppliedMcp?: ViewerCatalogScenario["suppliedMcp"];
	suppliedSkills?: string[];
}

interface CriterionGroup {
	title: string;
	intro?: string;
	items: ReactNode[];
}

function compareResultArms(result: ScenarioCompareResult): CompareArmResult[] {
	return result.arms.length > 0
		? result.arms
		: [result.a, result.b].filter((arm): arm is CompareArmResult => arm !== undefined);
}

function compareArmTurns(arm: CompareArmResult): number | undefined {
	return arm.trace?.messages.filter((message) => message.role === "assistant").length;
}

function describeCompareGate(gate: CompareGate, label: (id: string) => string): string {
	if ("winner" in gate) {
		return gate.metric === "outcome"
			? `${label(gate.winner)} must pass while ${label(gate.loser)} fails`
			: `${label(gate.winner)} must use fewer ${gate.metric} than ${label(gate.loser)}`;
	}
	if (gate.metric === "outcome" && gate.operator === "equal")
		return `${label(gate.arm)} is expected to ${gate.value}`;
	const operator = {
		equal: "must equal",
		lessThan: "must be less than",
		atMost: "must be at most",
		atLeast: "must be at least",
		greaterThan: "must be greater than",
	}[gate.operator];
	return `${label(gate.arm)} ${gate.metric} ${operator} ${gate.value}`;
}

function scenarioKey(suite: string, scenario: string): string {
	return `${suite}::${scenario}`;
}

function itemKey(kind: string, value: unknown, index: number): string {
	return `${kind}:${typeof value === "string" ? value : index}`;
}

function cellKey(suite: string, scenario: string, host: string, arm?: string): string {
	return `${suite}::${scenario}::${host}::${arm ?? "_"}`;
}

function resultCellKey(suite: string, scenario: string, host: string): string {
	return cellKey(suite, scenario, host);
}

function formatInteger(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function totalTokens(result: ScenarioResult): number | undefined {
	return (
		result.usage?.total?.totalTokens ??
		result.agentUsage?.totalTokens ??
		result.trace?.usage?.totalTokens
	);
}

function statusOfResult(result: ScenarioResult): Status {
	if (result.skipped) return "skipped";
	return result.passed ? "passed" : "failed";
}

function selectedRunLabel(run: ViewerRunRecord): string {
	const time = new Date(run.startedAt).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	const scope = run.request.scenario ?? run.request.suite ?? "all tests";
	return `${time} · ${scope} · ${run.status}`;
}

function resultFor(
	run: ViewerRunRecord | undefined,
	suite: string,
	scenario: string,
	host: string,
): ScenarioResult | undefined {
	return run?.reports
		.find((report) => report.suite === suite && report.host === host)
		?.results.find((result) => result.scenario === scenario);
}

function runFocus(
	run: ViewerRunRecord | undefined,
	catalog: ViewerCatalog,
): { scenario: string; host: string } | undefined {
	if (!run) return undefined;
	for (const report of run.reports) {
		if (run.request.suite && report.suite !== run.request.suite) continue;
		const result = run.request.scenario
			? report.results.find((item) => item.scenario === run.request.scenario)
			: report.results[0];
		if (result) return { scenario: scenarioKey(report.suite, result.scenario), host: report.host };
	}

	const suite = run.request.suite
		? catalog.suites.find((item) => item.name === run.request.suite)
		: catalog.suites.find((item) =>
				run.request.scenario
					? item.scenarios.some((scenario) => scenario.name === run.request.scenario)
					: false,
			);
	const scenario = run.request.scenario
		? suite?.scenarios.find((item) => item.name === run.request.scenario)
		: suite?.scenarios[0];
	if (!suite || !scenario) return undefined;
	return {
		scenario: scenarioKey(suite.name, scenario.name),
		host: run.request.hosts?.[0] ?? scenario.host ?? suite.hosts[0] ?? "",
	};
}

function scenarioStatus(
	run: ViewerRunRecord | undefined,
	live: Record<string, LiveCell>,
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
): Status {
	if (scenario.skip) return "skipped";
	if (!run) return "idle";

	const hosts = run.request.hosts?.length ? run.request.hosts : suite.hosts;
	const statuses = hosts.map((host) => hostScenarioStatus(run, live, suite, scenario, host));
	for (const status of [
		"cancelling",
		"running",
		"judging",
		"queued",
		"cancelled",
		"failed",
		"passed",
		"skipped",
	] as Status[]) {
		if (statuses.includes(status)) return status;
	}
	return "idle";
}

function hostScenarioStatus(
	run: ViewerRunRecord | undefined,
	live: Record<string, LiveCell>,
	suite: ViewerCatalogSuite,
	scenario: ViewerCatalogScenario,
	host: string,
): Status {
	if (scenario.skip || (scenario.host && scenario.host !== host)) return "skipped";
	if (
		!run ||
		(run.request.suite && run.request.suite !== suite.name) ||
		(run.request.scenario && run.request.scenario !== scenario.name) ||
		(run.request.hosts?.length && !run.request.hosts.some((requested) => requested === host))
	)
		return "idle";
	const result =
		resultFor(run, suite.name, scenario.name, host) ??
		live[resultCellKey(suite.name, scenario.name, host)]?.result;
	if (result) return statusOfResult(result);
	if (run.status === "cancelled" || run.status === "cancelling") return run.status;
	if (run.status === "completed") return "failed";
	const direct = live[resultCellKey(suite.name, scenario.name, host)];
	if (direct?.status === "judging" || direct?.judge) return "judging";
	if (direct) return "running";
	const arms = scenario.compare?.map(
		(arm) => live[cellKey(suite.name, scenario.name, host, arm.id)],
	);
	if (arms?.some(Boolean)) return "running";
	return "queued";
}

function StatusDot({ status }: { status: Status }) {
	return (
		<span
			className="test-nav-status"
			role="img"
			aria-label={`Test status: ${statusLabel(status)}`}
			title={statusLabel(status)}
		/>
	);
}

function codeList(values: string[]): ReactNode {
	return values.map((value, index) => (
		<span key={itemKey("code", value, index)}>
			{index > 0 ? ", " : null}
			<code>{value}</code>
		</span>
	));
}

function joinWorkspacePath(repositoryRoot: string | undefined, workspace: string): string {
	if (!repositoryRoot || workspace === ".") return repositoryRoot ?? workspace;
	const separator = repositoryRoot.includes("\\") ? "\\" : "/";
	return `${repositoryRoot.replace(/[\\/]+$/, "")}${separator}${workspace.replace(/^[\\/]+/, "")}`;
}

function editorUrl(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `vscode://file${encodeURI(absolutePath).replaceAll("#", "%23").replaceAll("?", "%3F")}`;
}

function CriteriaPanel({
	children,
	className,
	summary,
	title,
}: {
	children: ReactNode;
	className?: string;
	summary: string;
	title: string;
}) {
	return (
		<details className={`criteria-panel${className ? ` ${className}` : ""}`} open>
			<summary>
				<span>{title}</span>
				<span className="criteria-summary">{summary}</span>
			</summary>
			{children}
		</details>
	);
}

function CriterionGroups({ groups }: { groups: CriterionGroup[] }) {
	return (
		<div className="criterion-groups">
			{groups.map((group) => (
				<Criterion key={group.title} group={group} />
			))}
		</div>
	);
}

function StartingContext({
	target,
	repositoryRoot,
}: {
	target: CriteriaTarget;
	repositoryRoot?: string;
}) {
	const sources = target.contextSources ?? [];
	const servers = target.suppliedMcp ?? [];
	const tools = [...new Set(servers.flatMap((server) => server.tools))];
	const skills = target.suppliedSkills ?? [];
	const workspace = target.workspace ?? ".";
	const sourceFolder = joinWorkspacePath(repositoryRoot, workspace);
	const groups: CriterionGroup[] = [
		{
			title: "Workspace",
			items: [
				<>
					Source folder:{" "}
					{repositoryRoot ? (
						<a
							className="source-folder-link"
							href={editorUrl(sourceFolder)}
							title={`Open ${sourceFolder} in VS Code`}
						>
							{workspace}
						</a>
					) : (
						<code>{workspace}</code>
					)}
				</>,
				<>Runs in a sealed temporary copy, removed when the run finishes.</>,
			],
		},
		{
			title: "Delivery",
			items: [
				target.contextMode === "host-native" ? (
					<>Repository workspace; the host discovers its files and instructions.</>
				) : sources.length > 0 ? (
					<>Task prompt plus {codeList(sources)}.</>
				) : (
					<>Task prompt only.</>
				),
			],
		},
	];
	if (target.rubric.allowedCommands !== undefined) {
		groups.push({
			title: "Allowed commands",
			items: [
				target.rubric.allowedCommands.length ? (
					<>{codeList(target.rubric.allowedCommands)}.</>
				) : (
					<>None.</>
				),
			],
		});
	}
	if (servers.length || tools.length) {
		groups.push({
			title: "Services",
			items: [
				...(servers.length
					? [<>Servers: {codeList(servers.map((server) => server.name))}.</>]
					: []),
				...(tools.length ? [<>Tools: {codeList(tools)}.</>] : []),
			],
		});
	}
	if (skills.length)
		groups.push({ title: "Skills", items: [<>Available skills: {codeList(skills)}.</>] });
	return (
		<CriteriaPanel
			className="starting-context"
			summary={`${groups.length} sections`}
			title="Starting context"
		>
			<CriterionGroups groups={groups} />
		</CriteriaPanel>
	);
}

function criteriaGroups(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
	const reply: ReactNode[] = [];
	for (const text of rubric.must ?? [])
		reply.push(
			<>
				Final reply must include <code>{text}</code>.
			</>,
		);
	for (const text of rubric.mustNot ?? [])
		reply.push(
			<>
				The run must not contain <code>{text}</code>.
			</>,
		);
	if (reply.length) groups.push({ title: "Reply", items: reply });
	const commands: ReactNode[] = [
		...(rubric.mustRun ?? []).map((command) => (
			<>
				Must run a command matching <code>{command}</code>.
			</>
		)),
		...(rubric.mustRunSuccessfully ?? []).map((command) => (
			<>
				Must run a command matching <code>{command}</code> successfully.
			</>
		)),
	];
	if (commands.length) groups.push({ title: "Required commands", items: commands });
	const tools: React.ReactNode[] = [
		...(rubric.mustCallTool ?? []).map((tool) => (
			<>
				Must call <code>{tool}</code>.
			</>
		)),
		...(rubric.mustCallToolsInOrder ?? []).map((tool, index) => (
			<>
				{index + 1}. Call <code>{tool}</code>.
			</>
		)),
		...(rubric.mustNotCallTool ?? []).map((tool) => (
			<>
				Must not call <code>{tool}</code>.
			</>
		)),
	];
	if (tools.length) groups.push({ title: "Tools", items: tools });
	const files: React.ReactNode[] = [
		...(rubric.mustReadPath ?? []).map((path) => (
			<>
				Must read a path matching <code>{path}</code>.
			</>
		)),
		...(rubric.mustNotReadPath ?? []).map((path) => (
			<>
				Must not read a path matching <code>{path}</code>.
			</>
		)),
	];
	if (files.length) groups.push({ title: "Files", items: files });
	const skills: React.ReactNode[] = [
		...(rubric.mustInvokeSkill ?? []).map((skill) => (
			<>
				Must use <code>{skill}</code>.
			</>
		)),
		...(rubric.mustNotInvokeSkill ?? []).map((skill) => (
			<>
				Must not use <code>{skill}</code>.
			</>
		)),
	];
	if (skills.length) groups.push({ title: "Skills", items: skills });
	const judgeQuestions: ReactNode[] = (rubric.judge ?? []).map((judge) => (
		<>{typeof judge === "string" ? judge : judge.question}</>
	));
	if (judgeQuestions.length) groups.push({ title: "Judge question", items: judgeQuestions });
	const routing: React.ReactNode[] = [];
	if (rubric.handsOnRouting)
		routing.push("Must announce hands-on routing before the first tool call.");
	if (rubric.tier)
		routing.push(
			<>
				Must announce the <code>{rubric.tier}</code> tier.
			</>,
		);
	if (rubric.reviewDepth)
		routing.push(
			<>
				Must announce <code>{rubric.reviewDepth}</code> review depth.
			</>,
		);
	if (rubric.routingBlock) routing.push("Must announce a routing block.");
	if (routing.length) groups.push({ title: "Routing", items: routing });
	return groups;
}

function Criteria({ target }: { target: CriteriaTarget }) {
	const groups = criteriaGroups(target);
	const count = groups.reduce((sum, group) => sum + Math.max(group.items.length, 1), 0);
	return (
		<CriteriaPanel
			summary={count ? `${count} ${count === 1 ? "check" : "checks"}` : "Completion only"}
			title="Pass criteria"
		>
			{groups.length ? (
				<CriterionGroups groups={groups} />
			) : (
				<p className="criteria-empty">This test passes when it completes without a runner error.</p>
			)}
		</CriteriaPanel>
	);
}

function Criterion({ group }: { group: CriterionGroup }) {
	return (
		<section className="criterion-group">
			<h4>{group.title}</h4>
			{group.intro ? <p>{group.intro}</p> : null}
			<ul className="criterion-list">
				{group.items.map((item, index) => (
					<li key={itemKey(group.title, item, index)}>{item}</li>
				))}
			</ul>
		</section>
	);
}

function TaskDefinition({
	target,
	repositoryRoot,
}: {
	target: CriteriaTarget & { prompt: string };
	repositoryRoot?: string;
}) {
	return (
		<section className="test-intent">
			<p className="section-label">Task</p>
			<p className="prompt-preview">{target.prompt}</p>
			<StartingContext target={target} repositoryRoot={repositoryRoot} />
		</section>
	);
}

function CompareDefinition({
	scenario,
	repositoryRoot,
}: {
	scenario: ViewerCatalogScenario;
	repositoryRoot?: string;
}) {
	const arms = scenario.compare ?? [];
	const [selected, setSelected] = useState(arms[0]?.id);
	const arm = arms.find((candidate) => candidate.id === selected) ?? arms[0];
	const labels = new Map(arms.map((candidate) => [candidate.id, candidate.label]));
	const armRules = scenario.gates?.length
		? scenario.gates.map((gate) => `${describeCompareGate(gate, (id) => labels.get(id) ?? id)}.`)
		: arms.map((candidate) => `${candidate.label} must pass all of its criteria.`);
	return (
		<>
			<section className="test-intent comparison-task">
				<p className="section-label">Comparison task</p>
				<p className="prompt-preview">{scenario.prompt}</p>
			</section>
			<section className="comparison-criteria">
				<p className="section-label">Comparison pass criteria</p>
				<p className="comparison-intro">
					Each arm runs independently. These checks decide whether the comparison passes.
				</p>
				<div className="criterion-groups">
					{scenario.judgeMetrics?.length ? (
						<Criterion
							group={{
								title: "Acceptable behavior",
								intro:
									"The same questions are judged separately for every arm. The arm-result rules below decide which verdicts are required.",
								items: scenario.judgeMetrics.map((metric) => metric.question),
							}}
						/>
					) : null}
					{scenario.rubric.judge?.length ? (
						<Criterion
							group={{
								title: "Comparison judge",
								intro: "One judge sees all completed arms and evaluates the comparison as a whole.",
								items: scenario.rubric.judge.map((item) =>
									typeof item === "string" ? item : item.question,
								),
							}}
						/>
					) : null}
					<Criterion group={{ title: "Arm results", items: armRules }} />
				</div>
			</section>
			<section className="compare-definition compare-definition-tabbed">
				<p className="section-label">Arms</p>
				<TabList
					className="compare-definition-tabs"
					ariaLabel="Comparison arm definitions"
					items={arms}
					onSelect={setSelected}
					selectedId={arm?.id}
					tabClassName="compare-definition-tab"
				/>
				{arm ? (
					<article className="compare-arm-definition" data-compare-arm-definition={arm.id}>
						<header className="compare-arm-header">
							<h3>{arm.label}</h3>
							{arm.description ? (
								<p className="compare-arm-description">{arm.description}</p>
							) : null}
						</header>
						<TaskDefinition target={arm} repositoryRoot={repositoryRoot} />
						<Criteria target={arm} />
					</article>
				) : null}
			</section>
		</>
	);
}

function statusLabel(status: Status): string {
	return status === "idle" ? "Not run" : status;
}

function transcriptToolCalls(trace: AgentTrace): AgentTrace["toolCalls"] {
	if (!trace.shellCommands.length) return trace.toolCalls;
	const shellCommands = new Set(trace.shellCommands);
	return trace.toolCalls.filter((tool) => {
		const command = [tool.args?.command, tool.args?.cmd].find(
			(value): value is string => typeof value === "string",
		);
		if (command && shellCommands.has(command)) return false;
		return !["bash", "exec_command", "shell"].includes(tool.name.toLowerCase());
	});
}

function Trace({ trace, prompt }: { trace?: AgentTrace; prompt?: string }) {
	if (!trace)
		return (
			<details className="trace-details" open>
				<summary>
					<span className="trace-summary-title">Agent transcript</span>
					<span className="trace-summary-meta">0 messages · 0 tools</span>
				</summary>
				<p className="empty note">No transcript recorded for this scenario.</p>
			</details>
		);
	const toolCalls = transcriptToolCalls(trace);
	const timeline = [
		...trace.messages.map((message) => ({ kind: "message" as const, seq: message.seq, message })),
		...toolCalls.map((tool) => ({ kind: "tool" as const, seq: tool.seq, tool })),
	];
	const ordered = timeline.every((item) => item.seq !== undefined)
		? timeline.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
		: undefined;
	const showSubmittedPrompt = Boolean(
		prompt &&
			!trace.messages.some((message) => message.role === "user" && message.content === prompt),
	);
	return (
		<details className="trace-details" open>
			<summary>
				<span className="trace-summary-title">Agent transcript</span>
				<span className="trace-summary-meta">
					{trace.messages.length} messages · {toolCalls.length} tools
				</span>
			</summary>
			{ordered ? (
				<div className="chat">
					{showSubmittedPrompt ? <MessageBubble speaker="user" text={prompt ?? ""} /> : null}
					{ordered.map((item, index) =>
						item.kind === "message" ? (
							<MessageBubble
								key={itemKey("message", item.message, index)}
								speaker={item.message.role}
								text={item.message.content}
							/>
						) : (
							<ToolCard
								key={itemKey("tool", item.tool, index)}
								name={item.tool.name}
								args={item.tool.args}
							/>
						),
					)}
				</div>
			) : (
				<>
					<p className="empty note">
						Emission order wasn't recorded for this trace — messages and tool calls are shown in
						separate groups below.
					</p>
					<div className="chat">
						{showSubmittedPrompt ? <MessageBubble speaker="user" text={prompt ?? ""} /> : null}
						{trace.messages.map((message, index) => (
							<MessageBubble
								key={itemKey("message", message, index)}
								speaker={message.role}
								text={message.content}
							/>
						))}
					</div>
					{toolCalls.length ? (
						<>
							<h4>Tool calls</h4>
							<div className="chat">
								{toolCalls.map((tool, index) => (
									<ToolCard key={itemKey("tool", tool, index)} name={tool.name} args={tool.args} />
								))}
							</div>
						</>
					) : null}
				</>
			)}
		</details>
	);
}

function MessageBubble({
	speaker,
	text,
	label,
	streaming = false,
}: {
	speaker: string;
	text: string;
	label?: string;
	streaming?: boolean;
}) {
	return (
		<div className={`chat-row ${speaker === "user" ? "side-right" : "side-left"}`}>
			<div className={`bubble role-${speaker}${streaming ? " is-streaming" : ""}`}>
				<div className="bubble-label">{label ?? (speaker === "assistant" ? "Agent" : speaker)}</div>
				<div className="bubble-text">{text}</div>
			</div>
		</div>
	);
}

function displayToolPath(value: string): string {
	const stripped = value.replace(/^file:\/\//, "").replace(/\/+$/, "");
	const workspace = stripped.match(/\/agent-harness-seal-[^/]+(?:\/(.*))?$/);
	if (workspace) return workspace[1] || ".";
	const sealed = stripped.match(/\/(?:\.agents|\.claude|\.codex|AGENTS\.md|CLAUDE\.md)(?:\/|$)/);
	if (sealed?.index !== undefined) return stripped.slice(sealed.index + 1);
	const parts = stripped.split("/").filter(Boolean);
	return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : stripped;
}

function ToolCard({ name, args }: { name: string; args?: Record<string, unknown> }) {
	return (
		<div className="chat-row side-left">
			<div className="tool-card">
				<div className="tool-card-head">
					<span className="tool-name">{name}</span>
				</div>
				{args && Object.keys(args).length ? (
					<div className="tool-args">
						{Object.entries(args).map(([key, raw]) => {
							const source =
								raw === undefined
									? "undefined"
									: typeof raw === "string"
										? raw
										: JSON.stringify(raw);
							const pathLike =
								typeof source === "string" &&
								(key.toLowerCase().includes("path") ||
									source.startsWith("/") ||
									source.startsWith("file://"));
							const text = pathLike ? displayToolPath(source) : source.replaceAll("\n", " ↵ ");
							return (
								<div className="tool-arg" key={key}>
									<span className="tool-arg-key">{key}</span>
									<code title={pathLike ? source : undefined}>{text}</code>
								</div>
							);
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}

function StoryChecks({ checks }: { checks: StoryCheck[] }) {
	return (
		<ul className="story-checks">
			{checks.map((check, index) => {
				return (
					<li
						className={`story-check story-check-${check.status}`}
						key={itemKey("check", check, index)}
					>
						<span className="story-check-icon">
							{check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : "·"}
						</span>
						<span>{check.text}</span>
					</li>
				);
			})}
		</ul>
	);
}

function compareMetricValue(
	arm: CompareArmResult,
	metric: "turns" | "tokens" | "input" | "output" | "tools",
): number | undefined {
	if (metric === "turns") return compareArmTurns(arm);
	if (metric === "tools") return arm.trace?.toolCalls.length;
	const usage = arm.trace?.usage;
	if (metric === "tokens") return usage?.totalTokens;
	if (metric === "input") return usage?.inputTokens;
	return usage?.outputTokens;
}

function comparisonMetricClass(values: Array<number | undefined>, index: number): string {
	const numeric = values.filter((value): value is number => value !== undefined);
	if (numeric.length < 2) return "";
	const low = Math.min(...numeric);
	const high = Math.max(...numeric);
	if (low === high) return "";
	if (values[index] === low) return "is-better";
	if (values[index] === high) return "is-worse";
	return "";
}

function comparisonOutcomeClass(arm: CompareArmResult, gates: CompareGate[] | undefined): string {
	if (arm.passed) return "is-outcome-pass";
	const expectedFailure = gates?.some(
		(gate) =>
			!("winner" in gate) &&
			gate.arm === arm.id &&
			gate.metric === "outcome" &&
			gate.operator === "equal" &&
			gate.value === "fail",
	);
	return expectedFailure ? "is-expected-failure" : "is-outcome-fail";
}

function ComparisonTable({ compare }: { compare: ScenarioCompareResult }) {
	const arms = compareResultArms(compare);
	if (!arms.length) return null;
	const metrics = [
		["Turns", "turns"],
		["Tokens", "tokens"],
		["In", "input"],
		["Out", "output"],
		["Tools", "tools"],
	] as const;
	const showDelta = arms.length === 2;
	return (
		<div className="compare-table-wrap">
			<table className="compare-table">
				<thead>
					<tr>
						<th>Metric</th>
						{arms.map((arm) => (
							<th key={arm.id}>{arm.label}</th>
						))}
						{showDelta ? <th>Δ</th> : null}
					</tr>
				</thead>
				<tbody>
					<tr>
						<th scope="row">Outcome</th>
						{arms.map((arm) => (
							<td className={comparisonOutcomeClass(arm, compare.gates)} key={arm.id}>
								{arm.passed === undefined ? "n/a" : arm.passed ? "pass" : "fail"}
							</td>
						))}
						{showDelta ? <td className="delta-flat">n/a</td> : null}
					</tr>
					{metrics.map(([label, metric]) => {
						const values = arms.map((arm) => compareMetricValue(arm, metric));
						const delta = showDelta
							? values[0] === undefined || values[1] === undefined
								? undefined
								: values[1] - values[0]
							: undefined;
						return (
							<tr key={metric}>
								<th scope="row">{label}</th>
								{values.map((value, index) => (
									<td className={comparisonMetricClass(values, index)} key={arms[index]?.id}>
										{value === undefined ? "n/a" : formatInteger(value)}
									</td>
								))}
								{showDelta ? (
									<td
										className={
											delta === undefined || delta === 0
												? "delta-flat"
												: delta > 0
													? "delta-up"
													: "delta-down"
										}
									>
										{delta === undefined
											? "n/a"
											: delta > 0
												? `+${formatInteger(delta)}`
												: formatInteger(delta)}
									</td>
								) : null}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

const FAILURE_LABELS: Record<string, string> = {
	must: "Missing requirement",
	mustInclude: "Missing requirement",
	mustNot: "Forbidden behavior",
	mustNotInclude: "Forbidden behavior",
	mustRun: "Missing command",
	mustRunSuccessfully: "Missing command",
	allowedCommands: "Forbidden command",
	toHaveAllowedCommands: "Forbidden command",
	mustCallTool: "Missing tool call",
	mustCallToolsInOrder: "Missing tool call",
	mustNotCallTool: "Forbidden tool call",
	mustInvokeSkill: "Missing skill",
	mustNotInvokeSkill: "Unexpected skill",
	mustReadPath: "Missing read path",
	mustNotReadPath: "Forbidden read path",
	judge: "Judge",
	compareGate: "Comparison gate",
};

function failureLabel(matcher: string): string {
	const [base, ...suffix] = matcher.split(":");
	const label = FAILURE_LABELS[base ?? matcher] ?? matcher;
	return suffix.length ? `${label} — ${suffix.join(":")}` : label;
}

function Failures({ result }: { result: ScenarioResult }) {
	const { failures } = result;
	if (!failures.length) return null;
	return (
		<section className="failure-panel">
			<div className="failure-section-head">
				<div>
					<h3>What went wrong</h3>
					<p>
						{failures.length} {failures.length === 1 ? "issue" : "issues"} blocked this test
					</p>
				</div>
				<CopyError result={result} />
			</div>
			<ul className="failures">
				{failures.map((failure, index) => (
					<li className="failure-item" key={itemKey("failure", failure, index)}>
						<p className="failure-label">{failureLabel(failure.matcher)}</p>
						<p className="failure-message">{failure.message}</p>
						{failure.evidence ? (
							<details className="failure-evidence-details">
								<summary>Technical evidence</summary>
								<pre className="failure-evidence">{failure.evidence}</pre>
							</details>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

function debugUsage(usage?: AgentUsage): string {
	if (!usage) return "not reported";
	const total = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
	return `${formatInteger(total)} total (${formatInteger(usage.inputTokens ?? 0)} in / ${formatInteger(usage.outputTokens ?? 0)} out)`;
}

function debugText(value: string, limit = 4_000): string {
	return value.length > limit ? `${value.slice(0, limit)}\n… [truncated]` : value;
}

function appendTraceDebug(lines: string[], trace?: AgentTrace): void {
	if (!trace) {
		lines.push("- Trace: not recorded", "");
		return;
	}
	lines.push(
		`- Trace: ${trace.messages.length} messages, ${trace.toolCalls.length} tool calls`,
		`- Usage: ${debugUsage(trace.usage)}`,
	);
	if (trace.toolCalls.length) {
		lines.push("", "#### Tool calls");
		for (const tool of trace.toolCalls) {
			lines.push(`- ${tool.name}${tool.args ? ` ${JSON.stringify(tool.args)}` : ""}`);
			if (tool.result) lines.push(`  result: ${debugText(tool.result, 1_000)}`);
		}
	}
	const transcript = trace.messages
		.filter((message) => message.role === "user" || message.role === "assistant")
		.map((message) => `### ${message.role}\n${debugText(message.content)}`);
	if (transcript.length) lines.push("", "#### Agent transcript", "", ...transcript);
	lines.push("");
}

export function formatFailureDebugCopy(result: ScenarioResult): string {
	const lines = [
		"# agent-test viewer failure report",
		"",
		`- Suite: ${result.suite}`,
		`- Scenario: ${result.scenario}`,
		`- Duration: ${formatDuration(result.durationMs)}`,
		`- Result: ${result.passed ? "passed" : "failed"}`,
		`- Debug bundle: ${result.debugBundleDir ?? "not written"}`,
		"",
		"## Failures",
		"",
	];
	for (const failure of result.failures) {
		lines.push(`- [${failure.category ?? "unknown"}] ${failure.matcher}: ${failure.message}`);
		if (failure.evidence) lines.push(`  evidence: ${failure.evidence}`);
	}
	if (result.compare) {
		lines.push("", "## Comparison measurements", "");
		for (const arm of compareResultArms(result.compare)) {
			lines.push(
				`### ${arm.label} (${arm.id})`,
				`- Outcome: ${arm.passed === undefined ? "not reported" : arm.passed ? "pass" : "fail"}`,
				`- Prompt: ${arm.prompt}`,
				`- Turns: ${compareArmTurns(arm) ?? "not reported"}`,
				`- Tools: ${arm.trace?.toolCalls.length ?? "not reported"}`,
				`- Usage: ${debugUsage(arm.trace?.usage)}`,
				`- Duration: ${arm.durationMs === undefined ? "not reported" : formatDuration(arm.durationMs)}`,
				"",
			);
			appendTraceDebug(lines, arm.trace);
		}
		if (result.compare.gateResults?.length) {
			lines.push("## Gate results", "");
			for (const gate of result.compare.gateResults) {
				lines.push(
					`- ${gate.passed ? "PASS" : "FAIL"}: ${gate.message} (actual ${String(gate.left)} vs ${String(gate.right)})`,
				);
			}
			lines.push("");
		}
	} else {
		appendTraceDebug(lines, result.trace);
	}
	return lines.join("\n");
}

function CopyError({ result }: { result: ScenarioResult }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="copy-error"
			onClick={async () => {
				await navigator.clipboard.writeText(formatFailureDebugCopy(result));
				setCopied(true);
			}}
		>
			{copied ? "Copied" : "Copy error"}
		</button>
	);
}

function JudgeResponses({
	verdicts,
	inline = false,
}: {
	verdicts?: JudgeVerdictResult[];
	inline?: boolean;
}) {
	if (!verdicts?.length) return null;
	return (
		<section
			className={`judge-responses${inline ? " judge-responses-inline" : ""}`}
			aria-label="Judge responses"
			style={
				inline ? { background: "transparent", border: 0, padding: ".75rem 0 0 1rem" } : undefined
			}
		>
			{verdicts.map((verdict) => (
				<JudgeResponse inline={inline} key={verdict.id} verdict={verdict} />
			))}
		</section>
	);
}

function JudgeResponse({
	verdict,
	inline = false,
}: {
	verdict: Pick<JudgeVerdictResult, "question" | "rationale" | "evidence"> & { pass?: boolean };
	inline?: boolean;
}) {
	const state = verdict.pass === undefined ? "pending" : verdict.pass ? "pass" : "fail";
	const outcome = verdict.pass === undefined ? "Evaluating" : verdict.pass ? "Passed" : "Failed";
	return (
		<section
			className={`judge-response verdict-${state}${inline ? " judge-response-inline" : ""}`}
			aria-label={`Judge response: ${verdict.question}`}
			style={
				inline
					? {
							background: "transparent",
							border: 0,
							borderRadius: 0,
							color: "color-mix(in oklch, var(--arm-a) 72%, var(--text))",
							padding: 0,
						}
					: undefined
			}
		>
			{inline ? (
				<div className="judge-response-head">
					<h3>{verdict.question}</h3>
					<span className="judge-verdict-badge">{outcome}</span>
				</div>
			) : (
				<div className="judge-response-head">
					<h3>Judge response</h3>
					<span className="judge-verdict-badge">{outcome}</span>
				</div>
			)}
			<p className="judge-rationale">{verdict.rationale}</p>
			{verdict.evidence?.length ? (
				<ul className="judge-evidence">
					{verdict.evidence.map((item, index) => (
						<li key={itemKey("judge-evidence", item, index)}>
							<q>{item}</q>
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}

function partialJudgeField(text: string, field: string): string | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`));
	if (!match?.[1]) return undefined;
	try {
		return JSON.parse(`"${match[1]}"`) as string;
	} catch {
		return match[1].replaceAll('\\"', '"').replaceAll("\\n", "\n");
	}
}

function partialJudgeEvidence(text: string): string[] {
	const match = text.match(/"evidence"\s*:\s*(\[[\s\S]*?\])/);
	if (!match?.[1]) return [];
	try {
		const value = JSON.parse(match[1]) as unknown;
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function LiveJudgeResponses({ judge }: { judge: NonNullable<LiveCell["judge"]> }) {
	const verdict = partialJudgeField(judge.text, "verdict");
	const rationale = partialJudgeField(judge.text, "rationale");
	const evidence = partialJudgeEvidence(judge.text);
	const parsedPass = verdict === "yes" ? true : verdict === "no" ? false : undefined;
	return (
		<section className="judge-responses" aria-label="Judge responses">
			{judge.verdicts.map((item) => (
				<JudgeResponse key={item.id} verdict={item} />
			))}
			{judge.status === "running" ? (
				<JudgeResponse
					verdict={{
						question: judge.question,
						pass: parsedPass,
						rationale: rationale ?? "Evaluating…",
						evidence,
					}}
				/>
			) : null}
		</section>
	);
}

function ResultCard({ result }: { result: ScenarioResult }) {
	const [armId, setArmId] = useState(
		result.compare ? compareResultArms(result.compare)[0]?.id : undefined,
	);
	const arms = result.compare ? compareResultArms(result.compare) : [];
	const selectedArm = arms.find((arm) => arm.id === armId) ?? arms[0];
	const tokens = totalTokens(result);
	const storySections = result.story?.sections?.filter((section) => section.checks.length) ?? [];
	const judgeQuestionTexts = new Set(
		(result.judgeVerdicts ?? []).map((verdict) => verdict.question),
	);
	return (
		<details
			className={`scenario status-${statusOfResult(result)}${result.compare ? " compare-scenario" : ""}`}
			open={!result.skipped}
		>
			<summary>
				<span className={`badge status-${statusOfResult(result)}`}>{statusOfResult(result)}</span>
				<span className="scenario-heading">
					<span className="scenario-name">{result.scenario}</span>
					{result.description ? <span className="scenario-lede">{result.description}</span> : null}
				</span>
				{tokens !== undefined ? (
					<span className="tokens">{formatInteger(tokens)} tokens</span>
				) : null}
				<span className="duration">{formatDuration(result.durationMs)}</span>
			</summary>
			<div className="scenario-body">
				<div className="diagnostics">
					{result.compare ? <ComparisonTable compare={result.compare} /> : null}
					<div className="story">
						<section className="story-criteria">
							<h3>Pass criteria</h3>
							{storySections.length ? (
								storySections.map((section, index) => (
									<div
										className={`story-section${section.title && section.title.trim().toLowerCase() !== "compare" ? " story-section-titled" : ""}`}
										key={itemKey("story-section", section, index)}
									>
										{section.title && section.title.trim().toLowerCase() !== "compare" ? (
											<h4>{section.title}</h4>
										) : null}
										{section.description ? (
											<p className="story-section-description">{section.description}</p>
										) : null}
										<StoryChecks
											checks={section.checks.filter((check) => !judgeQuestionTexts.has(check.text))}
										/>
									</div>
								))
							) : result.story?.criteria.length ? (
								<StoryChecks
									checks={result.story.criteria
										.filter((text) => !judgeQuestionTexts.has(text))
										.map((text) => ({
											text,
											status: result.passed ? "pass" : "fail",
										}))}
								/>
							) : null}
							<JudgeResponses inline verdicts={result.judgeVerdicts} />
						</section>
					</div>
					<Failures result={result} />
				</div>
				{result.trace ? <TraceMeta result={result} /> : null}
				{arms.length ? (
					<div className="compare-layout compare-tabs">
						<TabList
							className="compare-tablist"
							items={arms}
							onSelect={setArmId}
							selectedId={selectedArm?.id}
							tabClassName="compare-tab"
						/>
						<div className="compare-arms" data-arm-count={arms.length}>
							{selectedArm ? (
								<article
									className="compare-arm"
									data-arm-id={selectedArm.id}
									style={{ display: "grid" }}
								>
									<Trace trace={selectedArm.trace} prompt={selectedArm.prompt} />
								</article>
							) : null}
							{arms
								.filter((arm) => arm.id !== selectedArm?.id)
								.map((arm) => (
									<article className="compare-arm" data-arm-id={arm.id} hidden key={arm.id} />
								))}
						</div>
					</div>
				) : (
					<Trace trace={result.trace} prompt={result.prompt} />
				)}
			</div>
		</details>
	);
}

function TraceMeta({ result }: { result: ScenarioResult }) {
	const trace = result.trace;
	if (!trace) return null;
	const toolCalls = transcriptToolCalls(trace);
	return (
		<div className="diagnostics meta-row">
			<section className="scenario-meta">
				<h3>Trace stats</h3>
				<div className="meta-grid">
					<div className="meta-item">
						<span className="meta-key">Messages</span>
						<span className="meta-val">{trace.messages.length}</span>
					</div>
					<div className="meta-item">
						<span className="meta-key">Tool calls</span>
						<span className="meta-val">{toolCalls.length}</span>
					</div>
					<div className="meta-item">
						<span className="meta-key">Shell commands</span>
						<span className="meta-val">{trace.shellCommands.length}</span>
					</div>
					{trace.routing?.tier ? (
						<div className="meta-item">
							<span className="meta-key">Tier</span>
							<span className="meta-val">{trace.routing.tier}</span>
						</div>
					) : null}
					{trace.skillsInvoked?.length ? (
						<div className="meta-item">
							<span className="meta-key">Skills</span>
							<span className="meta-val">{trace.skillsInvoked.join(", ")}</span>
						</div>
					) : null}
				</div>
				{trace.shellCommands.length ? (
					<div className="trace-command-list">
						<h4>Shell commands</h4>
						<ul className="shell-commands">
							{trace.shellCommands.map((command, index) => (
								<li key={itemKey("command", command, index)}>
									<code>{command}</code>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</section>
		</div>
	);
}

function LiveCellView({ cell }: { cell: LiveCell }) {
	if (cell.result && !cell.provisional) return <ResultCard result={cell.result} />;
	return (
		<article className="live-cell">
			{cell.status === "awaiting comparison" ? (
				<p>
					Agent finished. Awaiting comparison verdict.{" "}
					{cell.tokens ?? (cell.result ? totalTokens(cell.result) : undefined) ?? 0} tokens.
				</p>
			) : null}
			<ol className="live-status">
				{cell.statuses.map((status, index) => (
					<li key={itemKey("status", status, index)}>{status}</li>
				))}
			</ol>
			<div className="chat">
				{cell.items.map((item, index) =>
					item.kind === "message" ? (
						<MessageBubble
							key={itemKey("live-message", item, index)}
							speaker={item.role}
							text={item.text}
							streaming={item.streaming}
						/>
					) : (
						<ToolCard key={itemKey("live-tool", item, index)} name={item.name} args={item.args} />
					),
				)}
				{cell.status === "running" &&
				!cell.judge &&
				!cell.items.some(
					(item) => item.kind === "message" && item.role === "assistant" && item.streaming,
				) ? (
					<div className="chat-running-row side-left">
						<div className="chat-running">
							Running
							<span className="chat-progress" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
						</div>
					</div>
				) : null}
			</div>
			{cell.judge ? <LiveJudgeResponses judge={cell.judge} /> : null}
			{cell.status === "cancelled" ? (
				<div className="cell-result">
					<p className="cell-result-verdict">Cancelled.</p>
				</div>
			) : null}
		</article>
	);
}

function LiveCompare({
	arms,
}: {
	arms: Array<{ arm: NonNullable<ViewerCatalogScenario["compare"]>[number]; cell?: LiveCell }>;
}) {
	const [selectedId, setSelectedId] = useState(arms[0]?.arm.id);
	const selected = arms.find(({ arm }) => arm.id === selectedId) ?? arms[0];
	return (
		<div className="compare-layout compare-tabs">
			<TabList
				className="compare-tablist"
				ariaLabel="Live comparison arms"
				items={arms.map(({ arm }) => arm)}
				onSelect={setSelectedId}
				selectedId={selected?.arm.id}
				tabClassName="compare-tab"
			/>
			<div className="compare-arms" data-arm-count={arms.length}>
				{selected ? (
					<article
						className="compare-arm"
						data-arm-id={selected.arm.id}
						style={{ display: "grid" }}
					>
						{selected.cell ? <LiveCellView cell={selected.cell} /> : null}
					</article>
				) : null}
				{arms
					.filter(({ arm }) => arm.id !== selected?.arm.id)
					.map(({ arm }) => (
						<article className="compare-arm" data-arm-id={arm.id} hidden key={arm.id} />
					))}
			</div>
		</div>
	);
}

function RunSummary({
	reportMeta,
	reports,
}: {
	reportMeta?: ViewerBootstrap["reportMeta"];
	reports: SuiteRunReport[];
}) {
	const counts = reports
		.flatMap((report) => report.results)
		.reduce(
			(value, result) => {
				if (result.skipped) value.skipped++;
				else if (result.passed) value.passed++;
				else value.failed++;
				return value;
			},
			{ passed: 0, failed: 0, skipped: 0 },
		);
	const tokenTotals = reports
		.flatMap((report) => report.results)
		.map(totalTokens)
		.filter((value): value is number => value !== undefined)
		.sort((a, b) => a - b);
	return (
		<>
			<section className="summary" aria-label="Run verdict">
				<div className="stats">
					<span className="stat stat-pass">
						<strong>{counts.passed}</strong>
						<span>passed</span>
					</span>
					<span className="stat stat-fail">
						<strong>{counts.failed}</strong>
						<span>failed</span>
					</span>
					<span className="stat stat-skip">
						<strong>{counts.skipped}</strong>
						<span>skipped</span>
					</span>
				</div>
				<p className="when">
					{reportMeta?.host ?? [...new Set(reports.map((report) => report.host))].join(", ")} ·{" "}
					{reports.length} {reports.length === 1 ? "suite" : "suites"} · {reportMeta?.suitesDir} ·
					Generated {reportMeta?.generatedAt}
				</p>
			</section>
			<section className="guide" aria-labelledby="guide-heading">
				<h2 id="guide-heading">How to read this report</h2>
				<ol>
					<li>The verdict is pass or fail. Tokens are cost, not the score.</li>
					<li>Open a scenario for the criteria and result.</li>
					<li>In is prompt and context. Out is generated text.</li>
				</ol>
			</section>
			{tokenTotals.length ? (
				<section className="cost">
					<h2>Token cost</h2>
					<p className="cost-lede">Tokens are cost, not the verdict.</p>
					<div className="cost-grid">
						<div className="cost-item">
							<span className="cost-value">
								{formatInteger(tokenTotals[Math.floor(tokenTotals.length / 2)] ?? 0)}
							</span>
							<span className="cost-label">Typical</span>
						</div>
						<div className="cost-item">
							<span className="cost-value">{formatInteger(tokenTotals.at(-1) ?? 0)}</span>
							<span className="cost-label">Largest</span>
						</div>
					</div>
				</section>
			) : null}
		</>
	);
}

export default function ViewerApp({ bootstrap }: { bootstrap: ViewerBootstrap }) {
	const initialRunFocus = runFocus(
		bootstrap.runs.find((run) => run.id === bootstrap.selectedRunId),
		bootstrap.catalog,
	);
	const [runs, setRuns] = useState(bootstrap.runs);
	const [selectedRunId, setSelectedRunId] = useState(bootstrap.selectedRunId ?? "");
	const [selectedScenario, setSelectedScenario] = useState(() => {
		if (initialRunFocus) return initialRunFocus.scenario;
		const suite = bootstrap.catalog.suites[0];
		const scenario = suite?.scenarios[0];
		return suite && scenario ? scenarioKey(suite.name, scenario.name) : "";
	});
	const [selectedHosts, setSelectedHosts] = useState<string[]>(
		bootstrap.catalog.defaultSelectedHosts,
	);
	const [parallelHosts, setParallelHosts] = useState(true);
	const maxWorkers = bootstrap.capabilities.maxWorkers ?? 1;
	const [workers, setWorkers] = useState(bootstrap.capabilities.defaultWorkers ?? maxWorkers);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [hostByScenario, setHostByScenario] = useState<Record<string, string>>(() =>
		initialRunFocus?.host ? { [initialRunFocus.scenario]: initialRunFocus.host } : {},
	);
	const [liveByRun, setLiveByRun] = useState<Record<string, Record<string, LiveCell>>>({});
	const [banner, setBanner] = useState(
		bootstrap.reportMeta ? `${bootstrap.reportMeta.host} · ${bootstrap.reportMeta.suitesDir}` : "",
	);
	const [progress, setProgress] = useState<{
		done: number;
		total: number;
		passed: number;
		failed: number;
		skipped: number;
	}>();
	const sourcesRef = useRef<Record<string, EventSource>>({});
	const cancelledRunsRef = useRef(new Set<string>());
	const testStageRef = useRef<HTMLElement>(null);
	const selectedRun = runs.find((run) => run.id === selectedRunId);
	const activeRun = runs.find((run) => run.status === "running" || run.status === "cancelling");
	useEffect(
		() => () => {
			for (const source of Object.values(sourcesRef.current)) source.close();
		},
		[],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Restore the immutable bootstrap stream once; new runs connect in start().
	useEffect(() => {
		const run = bootstrap.runs.find(
			(entry) => entry.status === "running" || entry.status === "cancelling",
		);
		if (!run || sourcesRef.current[run.id]) return;
		const suites = bootstrap.catalog.suites
			.filter((suite) => !run.request.suite || suite.name === run.request.suite)
			.map((suite) => ({
				...suite,
				scenarios: suite.scenarios.filter(
					(scenario) => !run.request.scenario || scenario.name === run.request.scenario,
				),
			}));
		connect(
			run.id,
			runnableCount(suites, run.request.hosts ?? bootstrap.catalog.defaultSelectedHosts),
		);
	}, []);

	function selectScenario(key: string) {
		setSelectedScenario(key);
		testStageRef.current?.scrollTo({ top: 0 });
	}

	function selectRun(runId: string) {
		setSelectedRunId(runId);
		setBanner("");
		const focus = runFocus(
			runs.find((run) => run.id === runId),
			bootstrap.catalog,
		);
		if (!focus) return;
		selectScenario(focus.scenario);
		setHostByScenario((current) => ({ ...current, [focus.scenario]: focus.host }));
	}

	function runnableCount(suites: ViewerCatalogSuite[], hosts: string[]): number {
		return suites.reduce(
			(total, suite) =>
				total +
				suite.scenarios.reduce(
					(count, scenario) =>
						count +
						hosts.filter((host) => !scenario.skip && (!scenario.host || scenario.host === host))
							.length,
					0,
				),
			0,
		);
	}

	async function refreshRun(runId: string) {
		const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
		if (!response.ok) return;
		const detail = (await response.json()) as { run: ViewerRunRecord };
		setRuns((current) => current.map((run) => (run.id === runId ? detail.run : run)));
	}

	function updateCell(runId: string, key: string, update: (cell: LiveCell) => LiveCell) {
		setLiveByRun((all) => ({
			...all,
			[runId]: {
				...(all[runId] ?? {}),
				[key]: update(all[runId]?.[key] ?? { status: "idle", statuses: [], items: [] }),
			},
		}));
	}

	function handleEvent(runId: string, event: ViewerEvent) {
		if (event.type === "run_started") {
			setBanner(`Run ${runId} started.`);
			return;
		}
		if (event.type === "run_finished") {
			const cancelled = cancelledRunsRef.current.delete(runId) || event.status === "cancelled";
			setBanner(
				cancelled
					? "Run cancelled."
					: event.failed || event.skipped
						? `Run finished. ${event.passed} passed. ${event.failed} failed. ${event.skipped} skipped.`
						: `Run finished. ${event.passed} passed.`,
			);
			setRuns((current) =>
				current.map((run) =>
					run.id === runId
						? {
								...run,
								status: event.status ?? (run.status === "cancelling" ? "cancelled" : "completed"),
							}
						: run,
				),
			);
			setProgress((current) =>
				current
					? {
							total: current.total,
							done: event.passed + event.failed + event.skipped,
							passed: event.passed,
							failed: event.failed,
							skipped: event.skipped,
						}
					: current,
			);
			setLiveByRun((all) => ({
				...all,
				[runId]: Object.fromEntries(
					Object.entries(all[runId] ?? {}).map(([key, cell]) => [
						key,
						cell.result && !cell.provisional
							? cell
							: {
									...cell,
									status: cancelled ? "cancelled" : "failed",
									judge: cell.judge ? { ...cell.judge, status: "completed" } : undefined,
									items: cell.items.map((item) =>
										item.kind === "message" ? { ...item, streaming: false } : item,
									),
								},
					]),
				),
			}));
			void refreshRun(runId);
			sourcesRef.current[runId]?.close();
			delete sourcesRef.current[runId];
			return;
		}
		if (!("suite" in event) || !event.suite || !event.scenario || !event.host) return;
		const key = cellKey(event.suite, event.scenario, event.host, event.arm);
		if (event.type === "scenario_finalizing")
			updateCell(runId, key, (cell) => ({ ...cell, status: "judging" }));
		if (event.type === "cell_started")
			updateCell(runId, key, (cell) => ({ ...cell, status: "running", statuses: [], items: [] }));
		if (event.type === "status" && event.text !== "Starting host agent.")
			updateCell(runId, key, (cell) => ({ ...cell, statuses: [...cell.statuses, event.text] }));
		if (event.type === "prompt")
			updateCell(runId, key, (cell) => ({
				...cell,
				items: [...cell.items, { kind: "message", role: "user", text: event.text }],
			}));
		if (event.type === "text")
			updateCell(runId, key, (cell) => {
				const items = [...cell.items];
				const last = items.at(-1);
				if (last?.kind === "message" && last.role === "assistant" && last.streaming)
					items[items.length - 1] = { ...last, text: event.text };
				else items.push({ kind: "message", role: "assistant", text: event.text, streaming: true });
				return { ...cell, items };
			});
		if (event.type === "tool")
			updateCell(runId, key, (cell) => ({
				...cell,
				items: [
					...cell.items.map((item) =>
						item.kind === "message" ? { ...item, streaming: false } : item,
					),
					{ kind: "tool", name: event.name, args: event.args },
				],
			}));
		if (event.type === "judge_started")
			updateCell(runId, key, (cell) => ({
				...cell,
				status: "running",
				judge: {
					status: "running",
					id: event.id,
					question: event.question,
					text: "",
					verdicts: cell.judge?.verdicts ?? [],
				},
			}));
		if (event.type === "judge_text")
			updateCell(runId, key, (cell) => ({
				...cell,
				status: "running",
				judge: {
					status: "running",
					id: event.id,
					question: event.question,
					text: event.text,
					verdicts: cell.judge?.verdicts ?? [],
				},
			}));
		if (event.type === "judge")
			updateCell(runId, key, (cell) => ({
				...cell,
				judge: {
					status: "completed",
					id: event.verdicts.at(-1)?.id ?? cell.judge?.id ?? "judge",
					question: event.verdicts.at(-1)?.question ?? cell.judge?.question ?? "Judge criterion",
					text: cell.judge?.text ?? "",
					verdicts: [...(cell.judge?.verdicts ?? []), ...event.verdicts],
				},
			}));
		if (event.type === "scenario_result")
			updateCell(runId, key, (cell) => ({
				...cell,
				result: event.result,
				provisional: Boolean(event.arm),
				status: event.arm ? "awaiting comparison" : statusOfResult(event.result),
			}));
		if (event.type === "cell_finished")
			updateCell(runId, key, (cell) => ({
				...cell,
				status: event.arm
					? "awaiting comparison"
					: event.skipped
						? "skipped"
						: event.passed
							? "passed"
							: "failed",
				durationMs: event.durationMs,
				tokens: event.metrics?.tokens,
				items: cell.items.map((item) =>
					item.kind === "message" ? { ...item, streaming: false } : item,
				),
			}));
		if (event.type === "error")
			updateCell(runId, key, (cell) => ({
				...cell,
				status: "failed",
				items: [...cell.items, { kind: "message", role: "system", text: event.message }],
			}));
	}

	function connect(runId: string, total: number) {
		setProgress({ done: 0, total, passed: 0, failed: 0, skipped: 0 });
		const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
		sourcesRef.current[runId] = source;
		const results = new Map<string, ScenarioResult>();
		source.onopen = () => {
			results.clear();
			setLiveByRun((all) => ({ ...all, [runId]: {} }));
			setProgress({ done: 0, total, passed: 0, failed: 0, skipped: 0 });
		};
		source.onmessage = (message) => {
			const event = JSON.parse(message.data) as ViewerEvent;
			handleEvent(runId, event);
			if (event.type === "scenario_result" && !event.arm) {
				results.set(resultCellKey(event.suite, event.scenario, event.host), event.result);
				const values = [...results.values()];
				setProgress({
					total,
					done: values.length,
					passed: values.filter((r) => r.passed && !r.skipped).length,
					failed: values.filter((r) => !r.passed && !r.skipped).length,
					skipped: values.filter((r) => r.skipped).length,
				});
			}
		};
	}

	async function start(request: ViewerRunRequest, total: number) {
		if (activeRun) {
			setBanner("A run is already in progress. Cancel it first.");
			return;
		}
		const response = await fetch("/api/runs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
		});
		if (!response.ok) {
			const body = (await response.json()) as { error?: string };
			setBanner(body.error ?? "Unable to start run.");
			return;
		}
		const { runId } = (await response.json()) as { runId: string };
		const run: ViewerRunRecord = {
			id: runId,
			request,
			status: "running",
			startedAt: new Date().toISOString(),
			reports: [],
		};
		setRuns((current) => [...current, run]);
		setSelectedRunId(runId);
		setLiveByRun((current) => ({ ...current, [runId]: {} }));
		connect(runId, total);
	}

	async function cancel() {
		if (!activeRun) return;
		cancelledRunsRef.current.add(activeRun.id);
		setRuns((current) =>
			current.map((run) => (run.id === activeRun.id ? { ...run, status: "cancelling" } : run)),
		);
		await fetch(`/api/runs/${encodeURIComponent(activeRun.id)}/cancel`, { method: "POST" });
		setBanner("Stopping the run.");
		setLiveByRun((all) => ({
			...all,
			[activeRun.id]: Object.fromEntries(
				Object.entries(all[activeRun.id] ?? {}).map(([key, cell]) => [
					key,
					{ ...cell, status: cell.result ? cell.status : "cancelling" },
				]),
			),
		}));
	}

	const allScenarios = bootstrap.catalog.suites.flatMap((suite) =>
		suite.scenarios.map((scenario) => ({ suite, scenario })),
	);
	const reportMode = !bootstrap.capabilities.canRun;
	return (
		<main className="viewer-shell">
			{reportMode ? (
				<header className="viewer-topbar">
					<div className="viewer-identity">
						<h1>Run report</h1>
					</div>
				</header>
			) : null}
			{bootstrap.capabilities.canRun ? (
				<div className="viewer-command-row">
					<div className="toolbar-block">
						<button
							type="button"
							className="sidebar-toggle"
							aria-label="Sidebar"
							aria-controls="test-catalog"
							aria-expanded={sidebarOpen}
							title="Toggle test catalog sidebar"
							onClick={() => setSidebarOpen((open) => !open)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<rect x="3" y="4" width="18" height="16" rx="2" />
								<path d="M9 4v16" />
							</svg>
						</button>
						<p className="toolbar-label">Run hosts</p>
						<div className="host-toggles">
							{[...new Set(bootstrap.catalog.suites.flatMap((suite) => suite.hosts))].map(
								(host) => (
									<label key={host}>
										<input
											type="checkbox"
											data-host-toggle
											value={host}
											checked={selectedHosts.includes(host)}
											onChange={(event) =>
												setSelectedHosts((current) =>
													event.target.checked
														? [...current, host]
														: current.filter((item) => item !== host),
												)
											}
										/>
										{host}
									</label>
								),
							)}
						</div>
					</div>
					<label className="worker-control" htmlFor="viewer-workers">
						Workers
						<input
							id="viewer-workers"
							type="number"
							min="1"
							max={maxWorkers}
							step="1"
							inputMode="numeric"
							value={workers}
							disabled={Boolean(activeRun)}
							onChange={(event) => {
								const next = event.currentTarget.valueAsNumber;
								if (Number.isInteger(next) && next >= 1 && next <= maxWorkers) setWorkers(next);
							}}
						/>
					</label>
					<div className="run-actions">
						<button
							type="button"
							className={`primary run-toggle${activeRun ? " danger" : ""}`}
							id="run-selection"
							disabled={!activeRun && selectedHosts.length === 0}
							onClick={() =>
								activeRun
									? void cancel()
									: void start(
											{
												hosts: selectedHosts,
												parallelHosts: selectedHosts.length > 1 && parallelHosts,
												workers,
											},
											runnableCount(bootstrap.catalog.suites, selectedHosts),
										)
							}
						>
							{activeRun ? "Stop run" : "Start run"}
						</button>
						{selectedHosts.length > 1 ? (
							<label className="parallel-control">
								<input
									type="checkbox"
									id="parallel-hosts"
									checked={parallelHosts}
									onChange={(event) => setParallelHosts(event.target.checked)}
								/>
								Run hosts together
							</label>
						) : null}
					</div>
					{runs.length ? (
						<select
							className="run-history"
							id="run-history"
							aria-label="Run history"
							value={selectedRunId}
							onChange={(event) => selectRun(event.target.value)}
						>
							<option value="">Tests</option>
							{runs.map((run) => (
								<option value={run.id} key={run.id}>
									{selectedRunLabel(run)}
								</option>
							))}
						</select>
					) : null}
					<p
						className="run-banner lede"
						id="run-banner"
						aria-live="polite"
						hidden={!banner && !selectedRun}
					>
						{banner || (selectedRun ? selectedRunLabel(selectedRun) : "")}
					</p>
				</div>
			) : selectedRun ? (
				<RunSummary reportMeta={bootstrap.reportMeta} reports={selectedRun.reports} />
			) : null}
			{progress ? (
				<section className="run-progress" id="run-progress" aria-live="polite">
					<div className="run-progress-head">
						<p className="run-progress-title">
							{progress.done} of {progress.total} tests finished
						</p>
						<p className="run-arm-progress">
							{
								Object.entries(liveByRun[selectedRunId] ?? {}).filter(
									([key, cell]) => !key.endsWith("::_") && cell.result,
								).length
							}{" "}
							arms finished
						</p>
					</div>
					<div
						className="run-progress-track"
						role="progressbar"
						aria-label={`${progress.done} of ${progress.total} tests finished: ${progress.passed} passed, ${progress.failed} failed, ${progress.skipped} skipped`}
						aria-valuemin={0}
						aria-valuenow={progress.done}
						aria-valuemax={progress.total}
					>
						<span
							className="run-progress-segment run-progress-passed"
							style={{ width: `${progress.total ? (progress.passed / progress.total) * 100 : 0}%` }}
						/>
						<span
							className="run-progress-segment run-progress-failed"
							style={{ width: `${progress.total ? (progress.failed / progress.total) * 100 : 0}%` }}
						/>
						<span
							className="run-progress-segment run-progress-skipped"
							style={{
								width: `${progress.total ? (progress.skipped / progress.total) * 100 : 0}%`,
							}}
						/>
					</div>
					<div className="run-progress-counts">
						<span className="progress-passed">
							Passed <strong>{progress.passed}</strong>
						</span>
						<span className="progress-failed">
							Failed <strong>{progress.failed}</strong>
						</span>
						<span className="progress-skipped">
							Skipped <strong>{progress.skipped}</strong>
						</span>
						<span className="progress-remaining">
							Remaining <strong>{Math.max(progress.total - progress.done, 0)}</strong>
						</span>
					</div>
				</section>
			) : (
				<section className="run-progress" id="run-progress" hidden />
			)}
			<div className="viewer-workspace" data-sidebar-open={sidebarOpen}>
				<aside
					className="test-navigator"
					id="test-catalog"
					aria-label="Tests"
					hidden={!sidebarOpen}
				>
					<div className="test-navigator-heading">
						<div>
							<p className="section-label">Test catalog</p>
							<h2>{allScenarios.length} tests</h2>
						</div>
					</div>
					<label className="test-picker-label" htmlFor="test-picker">
						Selected test
					</label>
					<select
						className="test-picker"
						id="test-picker"
						value={selectedScenario}
						onChange={(event) => selectScenario(event.target.value)}
					>
						{allScenarios.map(({ suite, scenario }) => (
							<option
								value={scenarioKey(suite.name, scenario.name)}
								key={scenarioKey(suite.name, scenario.name)}
							>
								{suite.name} / {scenario.name}
							</option>
						))}
					</select>
					<nav className="test-tree" aria-label="Test catalog">
						{bootstrap.catalog.suites.map((suite) => (
							<section className="test-nav-suite" data-nav-suite={suite.name} key={suite.name}>
								<header>
									<div>
										<h2>{suite.name}</h2>
									</div>
									{bootstrap.capabilities.canRun ? (
										<button
											type="button"
											className="run-toggle run-suite"
											data-suite={suite.name}
											disabled={Boolean(activeRun) || selectedHosts.length === 0}
											onClick={() =>
												void start(
													{
														suite: suite.name,
														hosts: selectedHosts,
														parallelHosts: selectedHosts.length > 1 && parallelHosts,
														workers,
													},
													runnableCount([suite], selectedHosts),
												)
											}
										>
											Start suite
										</button>
									) : null}
								</header>
								<div className="test-nav-items">
									{suite.scenarios.map((scenario) => {
										const key = scenarioKey(suite.name, scenario.name);
										const status = scenarioStatus(
											selectedRun,
											liveByRun[selectedRunId] ?? {},
											suite,
											scenario,
										);
										return (
											<button
												type="button"
												className="test-nav-item"
												data-select-scenario={key}
												data-status={status}
												aria-current={key === selectedScenario}
												onClick={() => selectScenario(key)}
												key={key}
											>
												<StatusDot status={status} />
												<span className="test-nav-copy">
													<strong>{scenario.name}</strong>
													{scenario.description ? <small>{scenario.description}</small> : null}
												</span>
											</button>
										);
									})}
								</div>
							</section>
						))}
					</nav>
				</aside>
				<section className="test-stage" aria-label="Selected test" ref={testStageRef}>
					{allScenarios.map(({ suite, scenario }) => {
						const key = scenarioKey(suite.name, scenario.name);
						const scenarioHost =
							hostByScenario[key] ??
							(bootstrap.capabilities.canRun
								? (scenario.host ?? suite.hosts.find((host) => selectedHosts.includes(host)) ?? "")
								: (scenario.host ?? suite.hosts[0] ?? ""));
						return (
							<ScenarioCard
								key={key}
								suite={suite}
								scenario={scenario}
								repositoryRoot={bootstrap.workspace}
								selected={key === selectedScenario}
								selectedHost={scenarioHost}
								setSelectedHost={(host) =>
									setHostByScenario((current) => ({ ...current, [key]: host }))
								}
								selectedHosts={selectedHosts}
								activeRun={activeRun}
								selectedRun={selectedRun}
								live={liveByRun[selectedRunId] ?? {}}
								canRun={bootstrap.capabilities.canRun}
								start={(request, total) => void start(request, total)}
								cancel={() => void cancel()}
							/>
						);
					})}
				</section>
			</div>
		</main>
	);
}

function ScenarioCard({
	suite,
	scenario,
	repositoryRoot,
	selected,
	selectedHost,
	setSelectedHost,
	selectedHosts,
	activeRun,
	selectedRun,
	live,
	canRun,
	start,
	cancel,
}: {
	suite: ViewerCatalogSuite;
	scenario: ViewerCatalogScenario;
	repositoryRoot?: string;
	selected: boolean;
	selectedHost: string;
	setSelectedHost: (host: string) => void;
	selectedHosts: string[];
	activeRun?: ViewerRunRecord;
	selectedRun?: ViewerRunRecord;
	live: Record<string, LiveCell>;
	canRun: boolean;
	start: (request: ViewerRunRequest, total: number) => void;
	cancel: () => void;
}) {
	const key = scenarioKey(suite.name, scenario.name);
	const result = resultFor(selectedRun, suite.name, scenario.name, selectedHost);
	const directLive = live[resultCellKey(suite.name, scenario.name, selectedHost)];
	const armLive =
		scenario.compare
			?.map((arm) => live[cellKey(suite.name, scenario.name, selectedHost, arm.id)])
			.filter(Boolean) ?? [];
	const status = hostScenarioStatus(selectedRun, live, suite, scenario, selectedHost);
	const ownsActiveRun = Boolean(
		activeRun?.request.suite === suite.name &&
			activeRun.request.scenario === scenario.name &&
			activeRun.request.hosts?.includes(selectedHost),
	);
	return (
		<article
			className="scenario-card"
			data-scenario-card={key}
			data-selected={selected}
			hidden={!selected}
		>
			<header className="scenario-focus-header">
				<div className="scenario-heading-copy">
					<p className="scenario-path">{suite.name}</p>
					<h2>{scenario.name}</h2>
					{scenario.description ? <p className="scenario-lede">{scenario.description}</p> : null}
				</div>
				<span className="focus-verdict" data-status={status}>
					<span aria-hidden="true" />
					{statusLabel(status)}
				</span>
			</header>
			<div className="scenario-definition">
				{scenario.compare?.length ? (
					<CompareDefinition scenario={scenario} repositoryRoot={repositoryRoot} />
				) : (
					<>
						<TaskDefinition target={scenario} repositoryRoot={repositoryRoot} />
						<Criteria target={scenario} />
					</>
				)}
			</div>
			<div className="scenario-toolbar">
				<div className="host-runs">
					<span className="host-runs-label">Run with</span>
					<div className="host-tablist" role="tablist">
						{suite.hosts.map((host) => {
							const skipped = Boolean(scenario.skip || (scenario.host && scenario.host !== host));
							const hostStatus = hostScenarioStatus(selectedRun, live, suite, scenario, host);
							const visible = selectedHosts.length === 0 || selectedHosts.includes(host) || !canRun;
							return (
								<button
									type="button"
									className={`host-tab status-${hostStatus}`}
									data-cell={`${suite.name}::${scenario.name}::${host}`}
									data-host={host}
									role="tab"
									aria-label={host}
									aria-selected={host === selectedHost}
									disabled={skipped}
									hidden={!visible}
									onClick={() => setSelectedHost(host)}
									key={host}
								>
									{host}{" "}
									<span className={`cell-status status-${hostStatus}`} aria-hidden="true">
										{hostStatus === "skipped" && (scenario.skip || skipped) ? "skip" : hostStatus}
									</span>
								</button>
							);
						})}
					</div>
				</div>
				{canRun ? (
					<div className="scenario-actions">
						<button
							type="button"
							className={`primary run-toggle run-cell${ownsActiveRun ? " danger" : ""}`}
							data-suite={suite.name}
							data-scenario={scenario.name}
							data-host={selectedHost}
							disabled={!selectedHost || scenario.skip}
							onClick={() =>
								ownsActiveRun
									? cancel()
									: start(
											{
												suite: suite.name,
												scenario: scenario.name,
												hosts: [selectedHost],
												parallelHosts: false,
											},
											1,
										)
							}
						>
							{ownsActiveRun ? "Stop test" : "Start test"}
						</button>
					</div>
				) : null}
			</div>
			<div
				className="scenario-live"
				data-live-row={key}
				data-live-slot={key}
				hidden={!result && !directLive && !armLive.length}
			>
				<div className="host-panels">
					{suite.hosts.map((host) => {
						const hostResult =
							resultFor(selectedRun, suite.name, scenario.name, host) ??
							live[resultCellKey(suite.name, scenario.name, host)]?.result;
						const hostLive = live[resultCellKey(suite.name, scenario.name, host)];
						const hostArms =
							scenario.compare
								?.map((arm) => ({
									arm,
									cell: live[cellKey(suite.name, scenario.name, host, arm.id)],
								}))
								.filter(({ cell }) => Boolean(cell)) ?? [];
						return (
							<div
								className="host-panel"
								data-host-panel={host}
								role="tabpanel"
								hidden={host !== selectedHost}
								key={host}
							>
								{hostResult ? (
									<ResultCard result={hostResult} />
								) : hostArms.length ? (
									<>
										<p>
											{statusLabel(hostScenarioStatus(selectedRun, live, suite, scenario, host))}
										</p>
										<LiveCompare arms={hostArms} />
									</>
								) : hostLive ? (
									<LiveCellView cell={hostLive} />
								) : (
									<p className="host-empty">No run yet.</p>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</article>
	);
}
