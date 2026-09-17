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

const TRAILING_SEPARATOR = /[\\/]+$/;
const LEADING_SEPARATOR = /^[\\/]+/;
const FILE_PROTOCOL = /^file:\/\//;
const TRAILING_SLASH = /\/+$/;
const SEALED_WORKSPACE = /\/agent-harness-seal-[^/]+(?:\/(.*))?$/;
const AGENT_CONTEXT_PATH = /\/(?:\.agents|\.claude|\.codex|AGENTS\.md|CLAUDE\.md)(?:\/|$)/;
const EVIDENCE_ARRAY = /"evidence"\s*:\s*(\[[\s\S]*?\])/;

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
	authoring?: "typescript";
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

function cellKey(
	suite: string,
	{ scenario, host, arm }: { scenario: string; host: string; arm?: string },
): string {
	return `${suite}::${scenario}::${host}::${arm ?? "_"}`;
}

function resultCellKey(suite: string, scenario: string, host: string): string {
	return cellKey(suite, { scenario: scenario, host: host });
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
	{ suite, scenario, host }: { suite: string; scenario: string; host: string },
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
	return reportFocus(run) ?? catalogFocus(run, catalog);
}

function reportFocus(run: ViewerRunRecord) {
	for (const report of run.reports) {
		if (run.request.suite && report.suite !== run.request.suite) continue;
		const result = run.request.scenario
			? report.results.find((item) => item.scenario === run.request.scenario)
			: report.results[0];
		if (result) return { scenario: scenarioKey(report.suite, result.scenario), host: report.host };
	}

	return undefined;
}

function catalogFocus(run: ViewerRunRecord, catalog: ViewerCatalog) {
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
	{
		live,
		suite,
		scenario,
	}: { live: Record<string, LiveCell>; suite: ViewerCatalogSuite; scenario: ViewerCatalogScenario },
): Status {
	if (scenario.skip) return "skipped";
	if (!run) return "idle";

	const hosts = run.request.hosts?.length ? run.request.hosts : suite.hosts;
	const statuses = hosts.map((host) =>
		hostScenarioStatus(run, { live: live, suite: suite, scenario: scenario, host: host }),
	);
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

function runIncludesScenario(
	run: ViewerRunRecord,
	{
		suite,
		scenario,
		host,
	}: {
		suite: ViewerCatalogSuite;
		scenario: ViewerCatalogScenario;
		host: string;
	},
): boolean {
	if (run.request.suite && run.request.suite !== suite.name) return false;
	if (run.request.scenario && run.request.scenario !== scenario.name) return false;
	return !run.request.hosts?.length || run.request.hosts.includes(host);
}

function hostScenarioStatus(
	run: ViewerRunRecord | undefined,
	{
		live,
		suite,
		scenario,
		host,
	}: {
		live: Record<string, LiveCell>;
		suite: ViewerCatalogSuite;
		scenario: ViewerCatalogScenario;
		host: string;
	},
): Status {
	if (scenario.skip || (scenario.host && scenario.host !== host)) return "skipped";
	if (!run || !runIncludesScenario(run, { suite, scenario, host })) return "idle";
	const result =
		resultFor(run, { suite: suite.name, scenario: scenario.name, host: host }) ??
		live[resultCellKey(suite.name, scenario.name, host)]?.result;
	if (result) return statusOfResult(result);
	if (run.status === "cancelled" || run.status === "cancelling") return run.status;
	if (run.status === "completed") return "failed";
	return activeScenarioStatus(live, { suite, scenario, host });
}
function activeScenarioStatus(
	live: Record<string, LiveCell>,
	{
		suite,
		scenario,
		host,
	}: { suite: ViewerCatalogSuite; scenario: ViewerCatalogScenario; host: string },
): Status {
	const direct = live[resultCellKey(suite.name, scenario.name, host)];
	if (direct?.status === "judging" || direct?.judge) return "judging";
	if (direct) return "running";
	const arms = scenario.compare?.map(
		(arm) => live[cellKey(suite.name, { scenario: scenario.name, host: host, arm: arm.id })],
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
	return `${repositoryRoot.replace(TRAILING_SEPARATOR, "")}${separator}${workspace.replace(LEADING_SEPARATOR, "")}`;
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

function workspaceContextGroups(target: CriteriaTarget, repositoryRoot?: string): CriterionGroup[] {
	const sources = target.contextSources ?? [];
	const workspace = target.workspace ?? ".";
	const sourceFolder = joinWorkspacePath(repositoryRoot, workspace);
	return [
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
}

function startingContextGroups(target: CriteriaTarget, repositoryRoot?: string): CriterionGroup[] {
	const servers = target.suppliedMcp ?? [];
	const tools = [...new Set(servers.flatMap((server) => server.tools))];
	const skills = target.suppliedSkills ?? [];
	const groups = workspaceContextGroups(target, repositoryRoot);
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
	groups.push(...serviceContextGroups(servers, tools));
	if (skills.length)
		groups.push({ title: "Skills", items: [<>Available skills: {codeList(skills)}.</>] });
	return groups;
}

function StartingContext({
	target,
	repositoryRoot,
}: {
	target: CriteriaTarget;
	repositoryRoot?: string;
}) {
	if (target.authoring === "typescript")
		return (
			<div className="muted">
				Workspace, skills, and context are configured in the test and its agent definition. Each run
				records the supplied context and preserves workspace snapshots.
			</div>
		);
	const groups = startingContextGroups(target, repositoryRoot);
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
	return [
		...replyCriteria(target),
		...commandCriteria(target),
		...toolCriteria(target),
		...fileCriteria(target),
		...skillCriteria(target),
		...judgeCriteria(target),
		...routingCriteria(target),
	];
}

function replyCriteria(target: CriteriaTarget): CriterionGroup[] {
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
	return groups;
}

function commandCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
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
	return groups;
}

function toolCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
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
	return groups;
}

function fileCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
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
	return groups;
}

function skillCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
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
	return groups;
}

function judgeCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
	const judgeQuestions: ReactNode[] = (rubric.judge ?? []).map((judge) => (
		<>{typeof judge === "string" ? judge : judge.question}</>
	));
	if (judgeQuestions.length) groups.push({ title: "Judge question", items: judgeQuestions });
	return groups;
}

function routingCriteria(target: CriteriaTarget): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
	const rubric = target.rubric;
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
			summary={
				target.authoring === "typescript"
					? "Assertions in test code"
					: count
						? `${count} ${count === 1 ? "check" : "checks"}`
						: "Completion only"
			}
			title="Pass criteria"
		>
			{groups.length ? (
				<CriterionGroups groups={groups} />
			) : (
				<p className="criteria-empty">
					{target.authoring === "typescript"
						? "Assertions and judge thresholds are defined in the test callback and evaluated during execution."
						: "This test passes when it completes without a runner error."}
				</p>
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
	const ordered = traceTimeline(trace, toolCalls);
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
				<OrderedTranscript
					ordered={ordered}
					prompt={prompt}
					showSubmittedPrompt={showSubmittedPrompt}
				/>
			) : (
				<GroupedTranscript
					trace={trace}
					toolCalls={toolCalls}
					prompt={prompt}
					showSubmittedPrompt={showSubmittedPrompt}
				/>
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
	const stripped = value.replace(FILE_PROTOCOL, "").replace(TRAILING_SLASH, "");
	const workspace = stripped.match(SEALED_WORKSPACE);
	if (workspace) return workspace[1] || ".";
	const sealed = stripped.match(AGENT_CONTEXT_PATH);
	if (sealed?.index !== undefined) return stripped.slice(sealed.index + 1);
	const parts = stripped.split("/").filter(Boolean);
	return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : stripped;
}

function ToolArgument({ name, raw }: { name: string; raw: unknown }) {
	const source =
		raw === undefined ? "undefined" : typeof raw === "string" ? raw : JSON.stringify(raw);
	const pathLike =
		typeof source === "string" &&
		(name.toLowerCase().includes("path") || source.startsWith("/") || source.startsWith("file://"));
	const text = pathLike ? displayToolPath(source) : source.replaceAll("\n", " ↵ ");
	return (
		<div className="tool-arg">
			<span className="tool-arg-key">{name}</span>
			<code title={pathLike ? source : undefined}>{text}</code>
		</div>
	);
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
						{Object.entries(args).map(([name, raw]) => (
							<ToolArgument key={name} name={name} raw={raw} />
						))}
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
					{metrics.map(([label, metric]) => (
						<ComparisonMetricRow key={metric} label={label} metric={metric} arms={arms} />
					))}
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

function appendToolDebug(lines: string[], tool: AgentTrace["toolCalls"][number]): void {
	lines.push(`- ${tool.name}${tool.args ? ` ${JSON.stringify(tool.args)}` : ""}`);
	if (tool.result) lines.push(`  result: ${debugText(tool.result, 1_000)}`);
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
		for (const tool of trace.toolCalls) appendToolDebug(lines, tool);
	}
	const transcript = trace.messages
		.filter((message) => message.role === "user" || message.role === "assistant")
		.map((message) => `### ${message.role}\n${debugText(message.content)}`);
	if (transcript.length) lines.push("", "#### Agent transcript", "", ...transcript);
	lines.push("");
}

function appendComparisonDebug(lines: string[], compare: ScenarioCompareResult): void {
	lines.push("", "## Comparison measurements", "");
	for (const arm of compareResultArms(compare)) {
		appendArmDebug(lines, arm);
	}
	if (compare.gateResults?.length) {
		lines.push("## Gate results", "");
		for (const gate of compare.gateResults) {
			lines.push(
				`- ${gate.passed ? "PASS" : "FAIL"}: ${gate.message} (actual ${String(gate.left)} vs ${String(gate.right)})`,
			);
		}
		lines.push("");
	}
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
		appendComparisonDebug(lines, result.compare);
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
	const match = text.match(EVIDENCE_ARRAY);
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
	const arms = result.compare ? compareResultArms(result.compare) : [];
	const tokens = totalTokens(result);

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
						<ResultCriteria result={result} />
					</div>
					<Failures result={result} />
				</div>
				{result.trace ? <TraceMeta result={result} /> : null}
				{arms.length ? (
					<ResultComparison result={result} />
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

function useViewerSelection(bootstrap: ViewerBootstrap) {
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
	return {
		initialRunFocus,
		runs,
		setRuns,
		selectedRunId,
		setSelectedRunId,
		selectedScenario,
		setSelectedScenario,
		selectedHosts,
		setSelectedHosts,
		parallelHosts,
		setParallelHosts,
		maxWorkers,
		workers,
		setWorkers,
		sidebarOpen,
		setSidebarOpen,
		hostByScenario,
		setHostByScenario,
	};
}
function useViewerResults(bootstrap: ViewerBootstrap) {
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
	const [liveConnection, setLiveConnection] = useState<
		Record<string, "connected" | "reconnecting">
	>({});
	return {
		liveByRun,
		setLiveByRun,
		banner,
		setBanner,
		progress,
		setProgress,
		liveConnection,
		setLiveConnection,
	};
}
function useViewerConnections(
	_bootstrap: ViewerBootstrap,
	runs: ViewerRunRecord[],
	selectedRunId: string,
) {
	const sourcesRef = useRef<Record<string, EventSource>>({});
	const openedSourcesRef = useRef(new Set<string>());
	const cancelledRunsRef = useRef(new Set<string>());
	const testStageRef = useRef<HTMLElement>(null);
	const selectedRun = runs.find((run) => run.id === selectedRunId);
	const activeRun = runs.find((run) => run.status === "running" || run.status === "cancelling");
	return { sourcesRef, openedSourcesRef, cancelledRunsRef, testStageRef, selectedRun, activeRun };
}
function useViewerModel(bootstrap: ViewerBootstrap) {
	const selection = useViewerSelection(bootstrap);
	const results = useViewerResults(bootstrap);
	const connections = useViewerConnections(bootstrap, selection.runs, selection.selectedRunId);
	return { bootstrap, ...selection, ...results, ...connections };
}
type ViewerModel = ReturnType<typeof useViewerModel>;
class ViewerActions {
	constructor(private readonly model: ViewerModel) {}
	selectScenario = (key: string) => {
		const { setSelectedScenario, testStageRef } = this.model;

		setSelectedScenario(key);
		testStageRef.current?.scrollTo({ top: 0 });
	};
	selectRun = (runId: string) => {
		const { bootstrap, runs, setSelectedRunId, setHostByScenario, setBanner } = this.model;
		const { selectScenario } = this;

		setSelectedRunId(runId);
		setBanner("");
		const focus = runFocus(
			runs.find((run) => run.id === runId),
			bootstrap.catalog,
		);
		if (!focus) return;
		selectScenario(focus.scenario);
		setHostByScenario((current) => ({ ...current, [focus.scenario]: focus.host }));
	};
	runnableCount = (suites: ViewerCatalogSuite[], hosts: string[]) => {
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
	};
	refreshRun = async (runId: string) => {
		const { setRuns } = this.model;

		const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
		if (!response.ok) return;
		const detail = (await response.json()) as { run: ViewerRunRecord };
		setRuns((current) => current.map((run) => (run.id === runId ? detail.run : run)));
	};
	updateCell = (runId: string, key: string, update: (cell: LiveCell) => LiveCell) => {
		const { setLiveByRun } = this.model;

		setLiveByRun((all) => ({
			...all,
			[runId]: {
				...(all[runId] ?? {}),
				[key]: update(all[runId]?.[key] ?? { status: "idle", statuses: [], items: [] }),
			},
		}));
	};
	handleEvent = (runId: string, event: ViewerEvent) => {
		const { setBanner } = this.model;

		const { updateCell } = this;

		if (event.type === "run_started") {
			setBanner(`Run ${runId} started.`);
			return;
		}
		if (event.type === "run_finished") {
			this.finishRun(runId, event);
			return;
		}
		if (!("suite" in event) || !event.suite || !event.scenario || !event.host) return;
		const key = cellKey(event.suite, {
			scenario: event.scenario,
			host: event.host,
			arm: event.arm,
		});
		updateCell(runId, key, (cell) => reduceLiveCell(cell, event));
	};
	connect = (runId: string, total: number) => {
		const { setLiveByRun, setProgress, setLiveConnection, sourcesRef, openedSourcesRef } =
			this.model;
		const { handleEvent } = this;

		setProgress({ done: 0, total, passed: 0, failed: 0, skipped: 0 });
		openedSourcesRef.current.delete(runId);
		const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
		sourcesRef.current[runId] = source;
		const results = new Map<string, ScenarioResult>();
		source.onopen = () => {
			if (!openedSourcesRef.current.has(runId)) {
				openedSourcesRef.current.add(runId);
				results.clear();
				setLiveByRun((all) => ({ ...all, [runId]: {} }));
				setProgress({ done: 0, total, passed: 0, failed: 0, skipped: 0 });
			}
			setLiveConnection((all) => ({ ...all, [runId]: "connected" }));
		};
		source.onerror = () => {
			if (source.readyState !== EventSource.CLOSED)
				setLiveConnection((all) => ({ ...all, [runId]: "reconnecting" }));
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
	};
	start = async (request: ViewerRunRequest, total: number) => {
		const { setRuns, setSelectedRunId, setLiveByRun, setBanner, activeRun } = this.model;
		const { connect } = this;

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
	};
	cancel = async () => {
		const { setRuns, setLiveByRun, setBanner, cancelledRunsRef, activeRun } = this.model;

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
	};

	finishRun = (runId: string, event: Extract<ViewerEvent, { type: "run_finished" }>) => {
		const {
			setRuns,
			setBanner,
			setLiveConnection,
			sourcesRef,
			openedSourcesRef,
			cancelledRunsRef,
		} = this.model;
		const { refreshRun } = this;

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
		this.finishProgress(runId, { event, cancelled });
		setLiveConnection((all) => {
			const { [runId]: _removed, ...remaining } = all;
			return remaining;
		});
		openedSourcesRef.current.delete(runId);
		void refreshRun(runId);
		sourcesRef.current[runId]?.close();
		delete sourcesRef.current[runId];
		return;
	};

	finishProgress = (
		runId: string,
		{
			event,
			cancelled,
		}: { event: Extract<ViewerEvent, { type: "run_finished" }>; cancelled: boolean },
	) => {
		const { setProgress, setLiveByRun } = this.model;
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
					finishLiveCell(cell, cancelled),
				]),
			),
		}));
	};
}
function useViewerSubscriptions(model: ViewerModel, actions: ViewerActions) {
	const { bootstrap, sourcesRef } = model;
	const { connect, runnableCount } = actions;
	useEffect(
		() => () => {
			for (const source of Object.values(sourcesRef.current)) source.close();
		},
		[],
	);
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
}
export default function ViewerApp({ bootstrap }: { bootstrap: ViewerBootstrap }) {
	const model = useViewerModel(bootstrap);
	const actions = new ViewerActions(model);
	useViewerSubscriptions(model, actions);
	return <ViewerLayout model={model} actions={actions} />;
}
function ViewerLayout({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, sidebarOpen, progress, selectedRun } = model;

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
				<ViewerToolbar model={model} actions={actions} />
			) : selectedRun ? (
				<RunSummary reportMeta={bootstrap.reportMeta} reports={selectedRun.reports} />
			) : null}
			{progress ? <ActiveRunProgress model={model} actions={actions} /> : <ViewerProgress />}
			<div className="viewer-workspace" data-sidebar-open={sidebarOpen}>
				<TestNavigator model={model} actions={actions} />
				<TestStage model={model} actions={actions} />
			</div>
		</main>
	);
}

function ScenarioCard(props: ScenarioCardProps) {
	const { suite, scenario, selected, canRun } = props;
	const key = scenarioKey(suite.name, scenario.name);
	const { result, directLive, armLive, status } = scenarioCardState(props);
	return (
		<article
			className="scenario-card"
			data-scenario-card={key}
			data-selected={selected}
			hidden={!selected}
		>
			<ScenarioHeading suite={suite} scenario={scenario} status={status} />
			<ScenarioDefinition scenario={scenario} repositoryRoot={props.repositoryRoot} />
			<div className="scenario-toolbar">
				<ScenarioHosts {...props} />
				{canRun ? <ScenarioActions {...props} /> : null}
			</div>
			<div
				className="scenario-live"
				data-live-row={key}
				data-live-slot={key}
				hidden={!result && !directLive && !armLive.length}
			>
				<ScenarioHostPanels {...props} />
			</div>
		</article>
	);
}

function RunHostControls({ model }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, selectedHosts, setSelectedHosts, sidebarOpen, setSidebarOpen } = model;

	return (
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
				{[...new Set(bootstrap.catalog.suites.flatMap((suite) => suite.hosts))].map((host) => (
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
				))}
			</div>
		</div>
	);
}

function RunActions({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, selectedHosts, parallelHosts, setParallelHosts, workers, activeRun } = model;
	const { runnableCount, start, cancel } = actions;

	return (
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
	);
}

function ViewerToolbar({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { runs, selectedRunId, maxWorkers, workers, setWorkers, banner, selectedRun, activeRun } =
		model;
	const { selectRun } = actions;

	return (
		<div className="viewer-command-row">
			<RunHostControls model={model} actions={actions} />
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
			<RunActions model={model} actions={actions} />
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
	);
}

function ViewerProgress() {
	return <section className="run-progress" id="run-progress" hidden />;
}

function TestNavigator({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, selectedScenario, sidebarOpen } = model;
	const { selectScenario } = actions;
	const allScenarios = bootstrap.catalog.suites.flatMap((suite) =>
		suite.scenarios.map((scenario) => ({ suite, scenario })),
	);

	return (
		<aside className="test-navigator" id="test-catalog" aria-label="Tests" hidden={!sidebarOpen}>
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
			<TestTree model={model} actions={actions} />
		</aside>
	);
}

function TestStage({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, testStageRef } = model;

	const allScenarios = bootstrap.catalog.suites.flatMap((suite) =>
		suite.scenarios.map((scenario) => ({ suite, scenario })),
	);

	return (
		<section className="test-stage" aria-label="Selected test" ref={testStageRef}>
			{allScenarios.map(({ suite, scenario }) => (
				<SelectedScenario
					key={scenarioKey(suite.name, scenario.name)}
					model={model}
					actions={actions}
					suite={suite}
					scenario={scenario}
				/>
			))}
		</section>
	);
}

function ActiveRunProgress({ model }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap, selectedRunId, liveByRun, progress, liveConnection } = model;

	if (!progress) return null;
	return (
		<section className="run-progress" id="run-progress" aria-live="polite">
			<div className="run-progress-head">
				<p className="run-progress-title">
					{progress.done} of {progress.total} tests finished
				</p>
				<p
					className="run-arm-progress"
					hidden={bootstrap.catalog.suites.every((suite) =>
						suite.scenarios.every((scenario) => scenario.authoring === "typescript"),
					)}
				>
					{
						Object.entries(liveByRun[selectedRunId] ?? {}).filter(
							([key, cell]) => !key.endsWith("::_") && cell.result,
						).length
					}{" "}
					arms finished
				</p>
				{liveConnection[selectedRunId] ? (
					<p id="live-connection" data-state={liveConnection[selectedRunId]} aria-live="polite">
						{liveConnection[selectedRunId] === "connected"
							? "Live updates connected."
							: "Live updates reconnecting; received activity remains current."}
					</p>
				) : null}
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
	);
}

function TestTree({ model, actions }: { model: ViewerModel; actions: ViewerActions }) {
	const { bootstrap } = model;

	return (
		<nav className="test-tree" aria-label="Test catalog">
			{bootstrap.catalog.suites.map((suite) => (
				<SuiteNavigation key={suite.name} model={model} actions={actions} suite={suite} />
			))}
		</nav>
	);
}

type ScenarioCardProps = {
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
};

function ScenarioHosts({
	suite,
	scenario,
	selectedRun,
	live,
	selectedHosts,
	canRun,
	selectedHost,
	setSelectedHost,
}: Pick<
	ScenarioCardProps,
	| "suite"
	| "scenario"
	| "selectedRun"
	| "live"
	| "selectedHosts"
	| "canRun"
	| "selectedHost"
	| "setSelectedHost"
>) {
	return (
		<div className="host-runs">
			<span className="host-runs-label">Run with</span>
			<div className="host-tablist" role="tablist">
				{suite.hosts.map((host) => {
					const skipped = Boolean(scenario.skip || (scenario.host && scenario.host !== host));
					const hostStatus = hostScenarioStatus(selectedRun, {
						live: live,
						suite: suite,
						scenario: scenario,
						host: host,
					});
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
	);
}

function ScenarioActions({
	suite,
	scenario,
	selectedHost,
	activeRun,
	start,
	cancel,
}: Pick<
	ScenarioCardProps,
	"suite" | "scenario" | "selectedHost" | "activeRun" | "start" | "cancel"
>) {
	const ownsActiveRun = Boolean(
		activeRun?.request.suite === suite.name &&
			activeRun.request.scenario === scenario.name &&
			activeRun.request.hosts?.includes(selectedHost),
	);
	return (
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
	);
}

function ScenarioHostPanels({
	suite,
	scenario,
	selectedHost,
	selectedRun,
	live,
}: Pick<ScenarioCardProps, "suite" | "scenario" | "selectedHost" | "selectedRun" | "live">) {
	return (
		<div className="host-panels">
			{suite.hosts.map((host) => (
				<ScenarioHostPanel
					key={host}
					suite={suite}
					scenario={scenario}
					selectedHost={selectedHost}
					selectedRun={selectedRun}
					live={live}
					host={host}
				/>
			))}
		</div>
	);
}

function ResultCriteria({ result }: { result: ScenarioResult }) {
	const storySections =
		result.story?.sections?.filter(
			(section) =>
				section.checks.length || (result.authoring === "typescript" && section.notes?.length),
		) ?? [];
	const judgeQuestionTexts = new Set(
		(result.judgeVerdicts ?? []).map((verdict) => verdict.question),
	);
	return (
		<section className="story-criteria">
			<h3>{result.authoring === "typescript" ? "Run evidence and grades" : "Pass criteria"}</h3>
			{storySections.length ? (
				storySections.map((section, index) => (
					<ResultStorySection
						key={itemKey("story-section", section, index)}
						section={section}
						index={index}
						result={result}
						judgeQuestionTexts={judgeQuestionTexts}
					/>
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
	);
}

function ResultComparison({ result }: { result: ScenarioResult }) {
	const [armId, setArmId] = useState(
		result.compare ? compareResultArms(result.compare)[0]?.id : undefined,
	);
	const arms = result.compare ? compareResultArms(result.compare) : [];
	const selectedArm = arms.find((arm) => arm.id === armId) ?? arms[0];
	return (
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
					<article className="compare-arm" data-arm-id={selectedArm.id} style={{ display: "grid" }}>
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
	);
}

function ComparisonMetricRow({
	label,
	metric,
	arms,
}: {
	label: string;
	metric: Parameters<typeof compareMetricValue>[1];
	arms: CompareArmResult[];
}) {
	const showDelta = arms.length === 2;
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
			{showDelta ? <ComparisonDelta delta={delta} /> : null}
		</tr>
	);
}

function GroupedTranscript({
	trace,
	toolCalls,
	prompt,
	showSubmittedPrompt,
}: {
	trace: AgentTrace;
	toolCalls: AgentTrace["toolCalls"];
	prompt?: string;
	showSubmittedPrompt: boolean;
}) {
	return (
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
	);
}

function OrderedTranscript({
	ordered,
	prompt,
	showSubmittedPrompt,
}: {
	ordered: NonNullable<ReturnType<typeof traceTimeline>>;
	prompt?: string;
	showSubmittedPrompt: boolean;
}) {
	return (
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
	);
}

function traceTimeline(trace: AgentTrace, toolCalls: AgentTrace["toolCalls"]) {
	const timeline = [
		...trace.messages.map((message) => ({ kind: "message" as const, seq: message.seq, message })),
		...toolCalls.map((tool) => ({ kind: "tool" as const, seq: tool.seq, tool })),
	];
	const ordered = timeline.every((item) => item.seq !== undefined)
		? timeline.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
		: undefined;
	return ordered;
}

function reduceLiveCell(cell: LiveCell, event: ViewerEvent): LiveCell {
	switch (event.type) {
		case "scenario_finalizing":
			return reduceScenarioFinalizing(cell, event);
		case "cell_started":
			return reduceCellStarted(cell, event);
		case "status":
			return reduceStatus(cell, event);
		case "prompt":
			return reducePrompt(cell, event);
		case "text":
			return reduceText(cell, event);
		case "tool":
			return reduceTool(cell, event);
		case "judge_started":
			return reduceJudgeStarted(cell, event);
		case "judge_text":
			return reduceJudgeText(cell, event);
		case "judge":
			return reduceJudge(cell, event);
		case "scenario_result":
			return reduceScenarioResult(cell, event);
		case "cell_finished":
			return reduceCellFinished(cell, event);
		case "error":
			return reduceError(cell, event);
		default:
			return cell;
	}
}

function reduceScenarioFinalizing(
	cell: LiveCell,
	_event: Extract<ViewerEvent, { type: "scenario_finalizing" }>,
): LiveCell {
	return { ...cell, status: "judging" };
}

function reduceCellStarted(
	cell: LiveCell,
	_event: Extract<ViewerEvent, { type: "cell_started" }>,
): LiveCell {
	return { ...cell, status: "running", statuses: [], items: [] };
}

function reduceStatus(cell: LiveCell, event: Extract<ViewerEvent, { type: "status" }>): LiveCell {
	if (event.text === "Starting host agent.") return cell;
	return { ...cell, statuses: [...cell.statuses, event.text] };
}

function reducePrompt(cell: LiveCell, event: Extract<ViewerEvent, { type: "prompt" }>): LiveCell {
	return {
		...cell,
		items: [...cell.items, { kind: "message", role: "user", text: event.text }],
	};
}

function reduceText(cell: LiveCell, event: Extract<ViewerEvent, { type: "text" }>): LiveCell {
	const items = [...cell.items];
	const last = items.at(-1);
	if (last?.kind === "message" && last.role === "assistant" && last.streaming)
		items[items.length - 1] = { ...last, text: event.text };
	else items.push({ kind: "message", role: "assistant", text: event.text, streaming: true });
	return { ...cell, items };
}

function reduceTool(cell: LiveCell, event: Extract<ViewerEvent, { type: "tool" }>): LiveCell {
	return {
		...cell,
		items: [
			...cell.items.map((item) => (item.kind === "message" ? { ...item, streaming: false } : item)),
			{ kind: "tool", name: event.name, args: event.args },
		],
	};
}

function reduceJudgeStarted(
	cell: LiveCell,
	event: Extract<ViewerEvent, { type: "judge_started" }>,
): LiveCell {
	return {
		...cell,
		status: "judging",
		judge: {
			status: "running",
			id: event.id,
			question: event.question,
			text: "",
			verdicts: cell.judge?.verdicts ?? [],
		},
	};
}

function reduceJudgeText(
	cell: LiveCell,
	event: Extract<ViewerEvent, { type: "judge_text" }>,
): LiveCell {
	return {
		...cell,
		status: "judging",
		judge: {
			status: "running",
			id: event.id,
			question: event.question,
			text: event.text,
			verdicts: cell.judge?.verdicts ?? [],
		},
	};
}

function reduceJudge(cell: LiveCell, event: Extract<ViewerEvent, { type: "judge" }>): LiveCell {
	return {
		...cell,
		judge: {
			status: "completed",
			id: event.verdicts.at(-1)?.id ?? cell.judge?.id ?? "judge",
			question: event.verdicts.at(-1)?.question ?? cell.judge?.question ?? "Judge criterion",
			text: cell.judge?.text ?? "",
			verdicts: [...(cell.judge?.verdicts ?? []), ...event.verdicts],
		},
	};
}

function reduceScenarioResult(
	cell: LiveCell,
	event: Extract<ViewerEvent, { type: "scenario_result" }>,
): LiveCell {
	return {
		...cell,
		result: event.result,
		provisional: Boolean(event.arm),
		status: event.arm ? "awaiting comparison" : statusOfResult(event.result),
	};
}

function reduceCellFinished(
	cell: LiveCell,
	event: Extract<ViewerEvent, { type: "cell_finished" }>,
): LiveCell {
	return {
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
	};
}

function reduceError(cell: LiveCell, event: Extract<ViewerEvent, { type: "error" }>): LiveCell {
	return {
		...cell,
		status: "failed",
		items: [...cell.items, { kind: "message", role: "system", text: event.message }],
	};
}

function serviceContextGroups(
	servers: NonNullable<CriteriaTarget["suppliedMcp"]>,
	tools: string[],
): CriterionGroup[] {
	const groups: CriterionGroup[] = [];
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
	return groups;
}

function appendArmDebug(lines: string[], arm: CompareArmResult): void {
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

function ScenarioHostPanel({
	suite,
	scenario,
	selectedHost,
	selectedRun,
	live,
	host,
}: Pick<ScenarioCardProps, "suite" | "scenario" | "selectedHost" | "selectedRun" | "live"> & {
	host: string;
}) {
	const hostResult =
		resultFor(selectedRun, { suite: suite.name, scenario: scenario.name, host: host }) ??
		live[resultCellKey(suite.name, scenario.name, host)]?.result;
	const hostLive = live[resultCellKey(suite.name, scenario.name, host)];
	const hostArms =
		scenario.compare
			?.map((arm) => ({
				arm,
				cell: live[cellKey(suite.name, { scenario: scenario.name, host: host, arm: arm.id })],
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
						{statusLabel(
							hostScenarioStatus(selectedRun, {
								live: live,
								suite: suite,
								scenario: scenario,
								host: host,
							}),
						)}
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
}

function ResultStorySection({
	section,
	index,
	result,
	judgeQuestionTexts,
}: {
	section: NonNullable<NonNullable<ScenarioResult["story"]>["sections"]>[number];
	index: number;
	result: ScenarioResult;
	judgeQuestionTexts: Set<string>;
}) {
	const titled = Boolean(section.title && section.title.trim().toLowerCase() !== "compare");
	return (
		<div
			className={`story-section${titled ? " story-section-titled" : ""}`}
			key={itemKey("story-section", section, index)}
		>
			{titled ? <h4>{section.title}</h4> : null}
			{section.description ? (
				<p className="story-section-description">{section.description}</p>
			) : null}
			<StoryChecks checks={section.checks.filter((check) => !judgeQuestionTexts.has(check.text))} />
			{result.authoring === "typescript"
				? section.notes?.map((note, noteIndex) => (
						<p key={itemKey("evidence-note", note, noteIndex)}>{note}</p>
					))
				: null}
		</div>
	);
}

function SelectedScenario({
	model,
	actions,
	suite,
	scenario,
}: {
	model: ViewerModel;
	actions: ViewerActions;
	suite: ViewerCatalogSuite;
	scenario: ViewerCatalogScenario;
}) {
	const {
		bootstrap,
		selectedRunId,
		selectedScenario,
		selectedHosts,
		setHostByScenario,
		liveByRun,
		selectedRun,
		activeRun,
	} = model;
	const { start, cancel } = actions;

	const key = scenarioKey(suite.name, scenario.name);
	const scenarioHost = selectedScenarioHost(model, { suite, scenario, key });
	return (
		<ScenarioCard
			key={key}
			suite={suite}
			scenario={scenario}
			repositoryRoot={bootstrap.workspace}
			selected={key === selectedScenario}
			selectedHost={scenarioHost}
			setSelectedHost={(host) => setHostByScenario((current) => ({ ...current, [key]: host }))}
			selectedHosts={selectedHosts}
			activeRun={activeRun}
			selectedRun={selectedRun}
			live={liveByRun[selectedRunId] ?? {}}
			canRun={bootstrap.capabilities.canRun}
			start={(request, total) => void start(request, total)}
			cancel={() => void cancel()}
		/>
	);
}

function SuiteNavigation({
	model,
	actions,
	suite,
}: {
	model: ViewerModel;
	actions: ViewerActions;
	suite: ViewerCatalogSuite;
}) {
	const { bootstrap, selectedHosts, parallelHosts, workers, activeRun } = model;
	const { start, runnableCount } = actions;
	return (
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
			<SuiteTestLinks model={model} actions={actions} suite={suite} />
		</section>
	);
}

function ComparisonDelta({ delta }: { delta: number | undefined }) {
	return (
		<td
			className={
				delta === undefined || delta === 0 ? "delta-flat" : delta > 0 ? "delta-up" : "delta-down"
			}
		>
			{delta === undefined ? "n/a" : delta > 0 ? `+${formatInteger(delta)}` : formatInteger(delta)}
		</td>
	);
}

function ScenarioHeading({
	suite,
	scenario,
	status,
}: {
	suite: ViewerCatalogSuite;
	scenario: ViewerCatalogScenario;
	status: Status;
}) {
	return (
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
	);
}

function finishLiveCell(cell: LiveCell, cancelled: boolean): LiveCell {
	return cell.result && !cell.provisional
		? cell
		: {
				...cell,
				status: cancelled ? "cancelled" : "failed",
				judge: cell.judge ? { ...cell.judge, status: "completed" } : undefined,
				items: cell.items.map((item) =>
					item.kind === "message" ? { ...item, streaming: false } : item,
				),
			};
}

function scenarioCardState({
	suite,
	scenario,
	selectedRun,
	selectedHost,
	live,
}: Pick<ScenarioCardProps, "suite" | "scenario" | "selectedRun" | "selectedHost" | "live">) {
	const result = resultFor(selectedRun, {
		suite: suite.name,
		scenario: scenario.name,
		host: selectedHost,
	});
	const directLive = live[resultCellKey(suite.name, scenario.name, selectedHost)];
	const armLive =
		scenario.compare
			?.map(
				(arm) =>
					live[cellKey(suite.name, { scenario: scenario.name, host: selectedHost, arm: arm.id })],
			)
			.filter(Boolean) ?? [];
	const status = hostScenarioStatus(selectedRun, {
		live: live,
		suite: suite,
		scenario: scenario,
		host: selectedHost,
	});

	return { result, directLive, armLive, status };
}

function selectedScenarioHost(
	model: ViewerModel,
	{
		suite,
		scenario,
		key,
	}: { suite: ViewerCatalogSuite; scenario: ViewerCatalogScenario; key: string },
) {
	const { hostByScenario, bootstrap, selectedHosts } = model;
	const scenarioHost =
		hostByScenario[key] ??
		(bootstrap.capabilities.canRun
			? (scenario.host ?? suite.hosts.find((host) => selectedHosts.includes(host)) ?? "")
			: (scenario.host ?? suite.hosts[0] ?? ""));
	return scenarioHost;
}

function ScenarioDefinition({
	scenario,
	repositoryRoot,
}: Pick<ScenarioCardProps, "scenario" | "repositoryRoot">) {
	return (
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
	);
}

function SuiteTestLinks({
	model,
	actions,
	suite,
}: {
	model: ViewerModel;
	actions: ViewerActions;
	suite: ViewerCatalogSuite;
}) {
	const { selectedRun, liveByRun, selectedRunId, selectedScenario } = model;
	const { selectScenario } = actions;
	return (
		<div className="test-nav-items">
			{suite.scenarios.map((scenario) => {
				const key = scenarioKey(suite.name, scenario.name);
				const status = scenarioStatus(selectedRun, {
					live: liveByRun[selectedRunId] ?? {},
					suite: suite,
					scenario: scenario,
				});
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
	);
}
