import type { AgentTrace } from "@post-print/agent-harness";

import {
	buildCompareResult,
	type CompareStoryArm,
	type CompareStoryFields,
	describeCompareOutcome,
	resolveCompareMetricPairs,
} from "./compare-scenario.js";
import type {
	AssertionFailure,
	CompareMetricGate,
	JudgeVerdictResult,
	ScenarioRubric,
	ScenarioStory,
} from "./types.js";

const PATH_ARG_KEYS = ["path", "file_path", "filePath", "target_file", "uri", "cwd"] as const;
const EXCERPT_CHARS = 80;

export function quoteExcerpt(text: string): string {
	const compact = text.trim().replace(/\s+/g, " ");
	if (!compact) {
		return '""';
	}
	if (compact.length <= EXCERPT_CHARS) {
		return `"${compact}"`;
	}
	return `"${compact.slice(0, EXCERPT_CHARS - 1)}…"`;
}

function displayToolPath(path: string): string {
	const stripped = path.replace(/^file:\/\//, "");
	const sealed = stripped.match(/\/(?:\.agents|\.claude|\.codex|AGENTS\.md|CLAUDE\.md)(?:\/|$)/);
	if (sealed?.index !== undefined) {
		return stripped.slice(sealed.index + 1);
	}
	const parts = stripped.split("/").filter(Boolean);
	if (parts.length > 3) {
		return `…/${parts.slice(-3).join("/")}`;
	}
	return stripped;
}

export function pathFromArgs(args: Record<string, unknown> | undefined): string | undefined {
	if (!args) {
		return undefined;
	}
	for (const key of PATH_ARG_KEYS) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			return displayToolPath(value);
		}
	}
	return undefined;
}

function countLabel(count: number, singular: string, plural: string): string {
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

export type StoryCompareInput = Partial<CompareStoryFields> & {
	aLabel?: string;
	bLabel?: string;
	aDescription?: string;
	bDescription?: string;
	faster?: CompareMetricGate;
	cheaper?: CompareMetricGate;
	aRubric?: ScenarioRubric;
	bRubric?: ScenarioRubric;
	aTrace?: AgentTrace;
	bTrace?: AgentTrace;
	aDurationMs?: number;
	bDurationMs?: number;
};

function compareHeading(labels: string[]): string {
	if (labels.length === 2 && labels[0] && labels[1]) {
		return `compare ${labels[0]} vs ${labels[1]}`;
	}
	if (labels.length <= 1) {
		return labels[0] ? `compare ${labels[0]}` : "compare arms";
	}
	const last = labels[labels.length - 1];
	return `compare ${labels.slice(0, -1).join(", ")}, and ${last}`;
}

function labelForArm(arms: CompareStoryArm[], id: string): string {
	return arms.find((arm) => arm.id === id)?.label ?? id;
}

function normalizeStoryCompare(compare: StoryCompareInput): CompareStoryFields {
	if (compare.arms && compare.arms.length > 0) {
		const armIds = compare.arms.map((arm) => arm.id);
		return {
			arms: compare.arms,
			faster: Array.isArray(compare.faster)
				? compare.faster
				: resolveCompareMetricPairs(compare.faster, armIds),
			cheaper: Array.isArray(compare.cheaper)
				? compare.cheaper
				: resolveCompareMetricPairs(compare.cheaper, armIds),
			aLabel: compare.aLabel ?? compare.arms[0]?.label ?? "control",
			bLabel: compare.bLabel ?? compare.arms[1]?.label ?? "experimental",
			aDescription: compare.aDescription ?? compare.arms[0]?.description,
			bDescription: compare.bDescription ?? compare.arms[1]?.description,
			aRubric: compare.aRubric ?? compare.arms[0]?.rubric,
			bRubric: compare.bRubric ?? compare.arms[1]?.rubric,
		};
	}
	const aLabel = compare.aLabel ?? "control";
	const bLabel = compare.bLabel ?? "experimental";
	const arms: CompareStoryArm[] = [
		{
			id: "a",
			label: aLabel,
			description: compare.aDescription,
			rubric: compare.aRubric,
			trace: compare.aTrace,
			durationMs: compare.aDurationMs,
		},
		{
			id: "b",
			label: bLabel,
			description: compare.bDescription,
			rubric: compare.bRubric,
			trace: compare.bTrace,
			durationMs: compare.bDurationMs,
		},
	];
	return {
		arms,
		faster: resolveCompareMetricPairs(compare.faster, ["a", "b"]),
		cheaper: resolveCompareMetricPairs(compare.cheaper, ["a", "b"]),
		aLabel,
		bLabel,
		aDescription: compare.aDescription,
		bDescription: compare.bDescription,
		aRubric: compare.aRubric,
		bRubric: compare.bRubric,
	};
}

/** Rubric checks in one short line each. */
export function describeRubricChecks(
	rubric?: ScenarioRubric,
	compare?: StoryCompareInput,
): string[] {
	if (!rubric) {
		return ["no rubric recorded"];
	}
	const lines: string[] = [];
	for (const text of rubric.must ?? []) {
		lines.push(`reply includes ${quoteExcerpt(text)}`);
	}
	for (const text of rubric.mustNot ?? []) {
		lines.push(`reply omits ${quoteExcerpt(text)}`);
	}
	for (const command of rubric.mustRun ?? []) {
		lines.push(`run a command matching ${quoteExcerpt(command)}`);
	}
	for (const tool of rubric.mustCallTool ?? []) {
		lines.push(`call ${tool}`);
	}
	for (const tool of rubric.mustNotCallTool ?? []) {
		lines.push(`no ${tool} call`);
	}
	for (const path of rubric.mustReadPath ?? []) {
		lines.push(`read ${path}`);
	}
	for (const path of rubric.mustNotReadPath ?? []) {
		lines.push(`no read of ${path}`);
	}
	for (const skill of rubric.mustInvokeSkill ?? []) {
		lines.push(`invoke skill ${skill}`);
	}
	for (const skill of rubric.mustNotInvokeSkill ?? []) {
		lines.push(`no ${skill} skill`);
	}
	if (rubric.routingBlock) {
		lines.push("announce a routing block");
	}
	if (rubric.tier) {
		lines.push(`announce tier ${rubric.tier}`);
	}
	if (rubric.reviewDepth) {
		lines.push(`announce review depth ${rubric.reviewDepth}`);
	}
	if (compare) {
		const normalized = normalizeStoryCompare(compare);
		lines.push(compareHeading(normalized.arms.map((arm) => arm.label)));
		for (const arm of normalized.arms) {
			if (arm.description) {
				lines.push(`${arm.label}: ${arm.description}`);
			}
		}
		for (const pair of normalized.faster ?? []) {
			lines.push(
				`${labelForArm(normalized.arms, pair.winner)} is faster than ${labelForArm(normalized.arms, pair.loser)}`,
			);
		}
		for (const pair of normalized.cheaper ?? []) {
			lines.push(
				`${labelForArm(normalized.arms, pair.winner)} uses fewer tokens than ${labelForArm(normalized.arms, pair.loser)}`,
			);
		}
		for (const arm of normalized.arms) {
			for (const line of describeRubricChecks(arm.rubric)) {
				if (line === "no rubric checks" || line === "no rubric recorded") {
					continue;
				}
				lines.push(`${arm.label}: ${line}`);
			}
		}
	}
	if (rubric.judge && rubric.judge.length > 0) {
		lines.push(
			compare
				? `judge answers ${countLabel(rubric.judge.length, "question", "questions")} on ${normalizeStoryCompare(compare).arms.length === 2 ? "both arms" : "every arm"}`
				: `judge answers ${countLabel(rubric.judge.length, "question", "questions")}`,
		);
	}
	return lines.length > 0 ? lines : ["no rubric checks"];
}

/** What the agent said and which tools it used. */
export function describeTraceHappened(trace?: AgentTrace): string[] {
	if (!trace) {
		return ["no transcript"];
	}
	const lines: string[] = [];
	const assistant = [...trace.messages]
		.reverse()
		.find((message) => message.role === "assistant" && message.content.trim());
	if (assistant) {
		lines.push(`agent replied ${quoteExcerpt(assistant.content)}`);
	}
	if (trace.toolCalls.length === 0) {
		lines.push(assistant ? "no tools" : "no agent reply");
		return lines;
	}
	const shown = trace.toolCalls.slice(0, 6);
	for (const call of shown) {
		const path = pathFromArgs(call.args);
		lines.push(path ? `${call.name} ${path}` : call.name);
	}
	const extra = trace.toolCalls.length - shown.length;
	if (extra > 0) {
		lines.push(`${extra} more tool calls`);
	}
	return lines;
}

function shortenPathsInText(text: string): string {
	return text.replace(/(?:file:\/\/)?\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g, (path) =>
		displayToolPath(path),
	);
}

function describeFailure(failure: AssertionFailure): string {
	const message = shortenPathsInText(failure.message);
	if (failure.category === "worktree_leak") {
		return `worktree leak — ${message}`;
	}
	if (failure.category === "agent_runtime") {
		return `agent run failed — ${message}`;
	}
	if (failure.category === "judge_infra" || failure.category === "judge_parse") {
		return `judge failed — ${message}`;
	}
	if (failure.category === "recording_error") {
		return `recording failed — ${message}`;
	}
	return message;
}

/** Pass or fail in plain language. */
export function describeOutcome(options: {
	passed: boolean;
	skipped?: boolean;
	failures: AssertionFailure[];
	judgeVerdicts?: JudgeVerdictResult[];
}): string[] {
	if (options.skipped) {
		return ["skipped"];
	}
	if (options.passed) {
		const lines = ["all checks passed"];
		for (const verdict of options.judgeVerdicts ?? []) {
			if (verdict.rationale.trim()) {
				lines.push(`judge: ${verdict.rationale.trim()}`);
			}
		}
		return lines;
	}
	if (options.failures.length === 0) {
		return ["failed"];
	}
	return options.failures.map(describeFailure);
}

const REDUNDANT_VERDICT = new Set(["all checks passed", "skipped"]);

function storyVerdict(happened: string[], outcome: string[]): string[] {
	return outcome.filter((line) => !REDUNDANT_VERDICT.has(line) && !happened.includes(line));
}

export function buildScenarioStory(options: {
	rubric?: ScenarioRubric;
	trace?: AgentTrace;
	passed: boolean;
	skipped?: boolean;
	failures: AssertionFailure[];
	judgeVerdicts?: JudgeVerdictResult[];
	compare?: StoryCompareInput;
}): ScenarioStory {
	const compare = options.compare ? normalizeStoryCompare(options.compare) : undefined;
	const result = options.skipped
		? ["scenario skipped"]
		: compare
			? [
					...compare.arms.flatMap((arm) =>
						describeTraceHappened(arm.trace).map((line) => `${arm.label}: ${line}`),
					),
					...describeCompareOutcome(
						buildCompareResult(
							compare.arms.map((arm) => ({
								id: arm.id,
								label: arm.label,
								prompt: "",
								trace: arm.trace,
								durationMs: arm.durationMs,
							})),
							{ faster: compare.faster, cheaper: compare.cheaper },
						),
					),
				]
			: describeTraceHappened(options.trace);
	return {
		criteria: describeRubricChecks(options.rubric, options.compare),
		result,
		verdict: storyVerdict(result, describeOutcome(options)),
	};
}
