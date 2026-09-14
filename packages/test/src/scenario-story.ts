import type { AgentTrace } from "@post-print/agent-harness";

import { describeCompareOutcome } from "./compare-scenario.js";
import type {
	AssertionFailure,
	CompareArmId,
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

/** Rubric checks in one short line each. */
export function describeRubricChecks(
	rubric?: ScenarioRubric,
	compare?: {
		aLabel: string;
		bLabel: string;
		faster?: CompareArmId;
		cheaper?: CompareArmId;
		aRubric?: ScenarioRubric;
		bRubric?: ScenarioRubric;
	},
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
		lines.push(`compare ${compare.aLabel} vs ${compare.bLabel}`);
		if (compare.faster) {
			const winner = compare.faster === "a" ? compare.aLabel : compare.bLabel;
			const loser = compare.faster === "a" ? compare.bLabel : compare.aLabel;
			lines.push(`${winner} is faster than ${loser}`);
		}
		if (compare.cheaper) {
			const winner = compare.cheaper === "a" ? compare.aLabel : compare.bLabel;
			const loser = compare.cheaper === "a" ? compare.bLabel : compare.aLabel;
			lines.push(`${winner} uses fewer tokens than ${loser}`);
		}
		for (const line of describeRubricChecks(compare.aRubric)) {
			if (line === "no rubric checks" || line === "no rubric recorded") {
				continue;
			}
			lines.push(`${compare.aLabel}: ${line}`);
		}
		for (const line of describeRubricChecks(compare.bRubric)) {
			if (line === "no rubric checks" || line === "no rubric recorded") {
				continue;
			}
			lines.push(`${compare.bLabel}: ${line}`);
		}
	}
	if (rubric.judge && rubric.judge.length > 0) {
		lines.push(
			compare
				? `judge answers ${countLabel(rubric.judge.length, "question", "questions")} on both arms`
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
	compare?: {
		aLabel: string;
		bLabel: string;
		faster?: CompareArmId;
		cheaper?: CompareArmId;
		aRubric?: ScenarioRubric;
		bRubric?: ScenarioRubric;
		aTrace?: AgentTrace;
		bTrace?: AgentTrace;
		aDurationMs?: number;
		bDurationMs?: number;
	};
}): ScenarioStory {
	const result = options.skipped
		? ["scenario skipped"]
		: options.compare
			? [
					...describeTraceHappened(options.compare.aTrace).map(
						(line) => `${options.compare?.aLabel}: ${line}`,
					),
					...describeTraceHappened(options.compare.bTrace).map(
						(line) => `${options.compare?.bLabel}: ${line}`,
					),
					...describeCompareOutcome({
						a: {
							id: "a",
							label: options.compare.aLabel,
							prompt: "",
							trace: options.compare.aTrace,
							durationMs: options.compare.aDurationMs,
						},
						b: {
							id: "b",
							label: options.compare.bLabel,
							prompt: "",
							trace: options.compare.bTrace,
							durationMs: options.compare.bDurationMs,
						},
					}),
				]
			: describeTraceHappened(options.trace);
	return {
		criteria: describeRubricChecks(options.rubric, options.compare),
		result,
		verdict: storyVerdict(result, describeOutcome(options)),
	};
}
