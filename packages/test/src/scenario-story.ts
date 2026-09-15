import type { AgentTrace } from "@post-print/agent-harness";

import {
	buildCompareResult,
	type CompareStoryArm,
	type CompareStoryFields,
	describeCompareGate,
	describeCompareOutcome,
} from "./compare-scenario.js";
import type {
	AssertionFailure,
	CompareGate,
	JudgeVerdictResult,
	ScenarioRubric,
	ScenarioStory,
	StoryCheck,
	StorySection,
} from "./types.js";

interface RubricCheckSpec {
	text: string;
	matcher: string;
	needle: string;
}

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

/** Short workspace path for chat cards and story lines. */
export function displayToolPath(path: string): string {
	const stripped = path.replace(/^file:\/\//, "").replace(/\/+$/, "");
	const workspace = stripped.match(/\/agent-harness-seal-[^/]+(?:\/(.*))?$/);
	if (workspace) {
		return workspace[1] ? workspace[1] : ".";
	}
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
	gates?: CompareGate[];
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

function normalizeStoryCompare(compare: StoryCompareInput): CompareStoryFields {
	if (compare.arms && compare.arms.length > 0) {
		return {
			arms: compare.arms,
			gates: compare.gates,
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
		gates: compare.gates,
		aLabel,
		bLabel,
		aDescription: compare.aDescription,
		bDescription: compare.bDescription,
		aRubric: compare.aRubric,
		bRubric: compare.bRubric,
	};
}

function rubricCheckSpecs(rubric?: ScenarioRubric): RubricCheckSpec[] {
	if (!rubric) {
		return [];
	}
	const specs: RubricCheckSpec[] = [];
	for (const text of rubric.must ?? []) {
		specs.push({
			text: `reply includes ${quoteExcerpt(text)}`,
			matcher: "mustInclude",
			needle: text,
		});
	}
	for (const text of rubric.mustNot ?? []) {
		specs.push({
			text: `reply omits ${quoteExcerpt(text)}`,
			matcher: "mustNotInclude",
			needle: text,
		});
	}
	for (const command of rubric.mustRun ?? []) {
		specs.push({
			text: `run a command matching ${quoteExcerpt(command)}`,
			matcher: "toHaveRunCommand",
			needle: command,
		});
	}
	for (const command of rubric.mustRunSuccessfully ?? []) {
		specs.push({
			text: `run ${quoteExcerpt(command)} successfully`,
			matcher: "toHaveRunCommandSuccessfully",
			needle: command,
		});
	}
	if (rubric.allowedCommands !== undefined) {
		specs.push({
			text: "shell commands stay on the allowlist",
			matcher: "toHaveAllowedCommands",
			needle: "allowlist",
		});
	}
	for (const tool of rubric.mustCallTool ?? []) {
		specs.push({ text: `call ${tool}`, matcher: "toHaveCalledTool", needle: tool });
	}
	for (const tool of rubric.mustCallToolsInOrder ?? []) {
		specs.push({
			text: `call ${tool} in order`,
			matcher: "toHaveCalledToolsInOrder",
			needle: tool,
		});
	}
	for (const tool of rubric.mustNotCallTool ?? []) {
		specs.push({ text: `no ${tool} call`, matcher: "toHaveNotCalledTool", needle: tool });
	}
	for (const path of rubric.mustReadPath ?? []) {
		specs.push({ text: `read ${path}`, matcher: "toHaveReadPath", needle: path });
	}
	for (const path of rubric.mustNotReadPath ?? []) {
		specs.push({ text: `no read of ${path}`, matcher: "toHaveNotReadPath", needle: path });
	}
	for (const skill of rubric.mustInvokeSkill ?? []) {
		specs.push({
			text: `invoke skill ${skill}`,
			matcher: "toHaveInvokedSkill",
			needle: skill,
		});
	}
	for (const skill of rubric.mustNotInvokeSkill ?? []) {
		specs.push({
			text: `no ${skill} skill`,
			matcher: "toHaveNotInvokedSkill",
			needle: skill,
		});
	}
	if (rubric.routingBlock) {
		specs.push({
			text: "announce a routing block",
			matcher: "toIncludeRoutingBlock",
			needle: "Routing",
		});
	}
	if (rubric.tier) {
		specs.push({
			text: `announce tier ${rubric.tier}`,
			matcher: "toHaveTier",
			needle: rubric.tier,
		});
	}
	if (rubric.reviewDepth) {
		specs.push({
			text: `announce review depth ${rubric.reviewDepth}`,
			matcher: "toHaveReviewDepth",
			needle: rubric.reviewDepth,
		});
	}
	return specs;
}

function matcherMatches(actual: string, expected: string): boolean {
	if (actual === expected) {
		return true;
	}
	if (expected === "toIncludeRoutingBlock") {
		return actual.includes("Routing") || actual.includes("routing");
	}
	if (expected === "toHaveTier") {
		return actual === "toHaveHandsOnTier" || actual === "toHaveHandsOnTierBeforeTools";
	}
	return false;
}

function specFailed(
	failures: AssertionFailure[],
	spec: RubricCheckSpec,
	armLabel?: string,
): boolean {
	return failures.some((failure) => {
		if (armLabel && !failure.message.startsWith(`${armLabel}: `)) {
			return false;
		}
		if (!matcherMatches(failure.matcher, spec.matcher)) {
			return false;
		}
		const message = armLabel ? failure.message.slice(armLabel.length + 2) : failure.message;
		return message.includes(spec.needle);
	});
}

function scoreSpecs(
	specs: RubricCheckSpec[],
	failures: AssertionFailure[],
	armLabel?: string,
): StoryCheck[] {
	return specs.map((spec) => ({
		text: spec.text,
		status: specFailed(failures, spec, armLabel) ? "fail" : "pass",
	}));
}

function judgeChecks(
	rubric: ScenarioRubric | undefined,
	failures: AssertionFailure[],
	judgeVerdicts: JudgeVerdictResult[] | undefined,
	armCount?: number,
): StoryCheck[] {
	if (!rubric?.judge || rubric.judge.length === 0) {
		return [];
	}
	if (judgeVerdicts && judgeVerdicts.length > 0) {
		return judgeVerdicts.map((verdict) => ({
			text: verdict.question.trim() || `judge ${verdict.id}`,
			status: verdict.pass ? "pass" : "fail",
		}));
	}
	const failed = failures.some(
		(failure) => failure.matcher === "judge" || failure.matcher.startsWith("judge:"),
	);
	const scope = armCount === undefined ? "" : ` on ${armCount === 2 ? "both arms" : "every arm"}`;
	return [
		{
			text: `judge answers ${countLabel(rubric.judge.length, "question", "questions")}${scope}`,
			status: failed ? "fail" : "pass",
		},
	];
}

function buildCompareMetricSection(
	compare: CompareStoryFields,
	failures: AssertionFailure[],
	judge: StoryCheck[],
): StorySection | undefined {
	const result = buildCompareResult(
		compare.arms.map((arm) => ({
			id: arm.id,
			label: arm.label,
			prompt: "",
			trace: arm.trace,
			durationMs: arm.durationMs,
			passed: arm.passed,
			judgeVerdicts: arm.judgeVerdicts,
		})),
		compare.gates,
	);
	const outcomes = describeCompareOutcome(result);
	const labels = new Map(compare.arms.map((arm) => [arm.id, arm.label]));
	const checks: StoryCheck[] = (compare.gates ?? []).map((gate) => ({
		text: describeCompareGate(gate, (id) => labels.get(id) ?? id),
		status: failures.some((failure) => failure.matcher === `compareGate:${gate.metric}`)
			? "fail"
			: "pass",
	}));
	checks.push(...judge);
	const notes = outcomes;
	if (checks.length === 0 && notes.length === 0) {
		return undefined;
	}
	return { title: "compare", checks, notes };
}

function buildStorySections(options: {
	rubric?: ScenarioRubric;
	trace?: AgentTrace;
	failures: AssertionFailure[];
	judgeVerdicts?: JudgeVerdictResult[];
	compare?: StoryCompareInput;
}): StorySection[] {
	const compare = options.compare ? normalizeStoryCompare(options.compare) : undefined;
	if (!compare) {
		const checks = [
			...scoreSpecs(rubricCheckSpecs(options.rubric), options.failures),
			...judgeChecks(options.rubric, options.failures, options.judgeVerdicts),
		];
		return [
			{
				checks: checks.length > 0 ? checks : [{ text: "no rubric checks", status: "info" }],
				notes: describeTraceHappened(options.trace),
			},
		];
	}
	const sharedSpecs = rubricCheckSpecs(options.rubric);
	const sections: StorySection[] = compare.arms.map((arm) => {
		const armFailures = arm.failures;
		return {
			title: arm.label,
			description: arm.description,
			checks: scoreSpecs(
				[...sharedSpecs, ...rubricCheckSpecs(arm.rubric)],
				armFailures ?? options.failures,
				armFailures ? undefined : arm.label,
			),
			notes: describeTraceHappened(arm.trace),
		};
	});
	const compareSection = buildCompareMetricSection(
		compare,
		options.failures,
		judgeChecks(options.rubric, options.failures, options.judgeVerdicts, compare.arms.length),
	);
	if (compareSection) {
		sections.push(compareSection);
	}
	return sections;
}

/** Rubric checks in one short line each. */
export function describeRubricChecks(
	rubric?: ScenarioRubric,
	compare?: StoryCompareInput,
): string[] {
	if (!rubric) {
		return ["no rubric recorded"];
	}
	const lines = rubricCheckSpecs(rubric).map((spec) => spec.text);
	if (compare) {
		const normalized = normalizeStoryCompare(compare);
		lines.push(compareHeading(normalized.arms.map((arm) => arm.label)));
		for (const arm of normalized.arms) {
			if (arm.description) {
				lines.push(`${arm.label}: ${arm.description}`);
			}
		}
		const labels = new Map(normalized.arms.map((arm) => [arm.id, arm.label]));
		for (const gate of normalized.gates ?? []) {
			lines.push(describeCompareGate(gate, (id) => labels.get(id) ?? id));
		}
		for (const arm of normalized.arms) {
			for (const spec of rubricCheckSpecs(arm.rubric)) {
				lines.push(`${arm.label}: ${spec.text}`);
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

function failureIsScored(
	failure: AssertionFailure,
	rubric: ScenarioRubric | undefined,
	compare: CompareStoryFields | undefined,
): boolean {
	if (
		failure.category === "worktree_leak" ||
		failure.category === "agent_runtime" ||
		failure.category === "judge_infra" ||
		failure.category === "judge_parse" ||
		failure.category === "recording_error"
	) {
		return false;
	}
	if (failure.matcher === "judge" || failure.matcher.startsWith("judge:")) {
		return true;
	}
	if (compare) {
		for (const arm of compare.arms) {
			const specs = [...rubricCheckSpecs(rubric), ...rubricCheckSpecs(arm.rubric)];
			if (specs.some((spec) => specFailed([failure], spec, arm.label))) {
				return true;
			}
		}
		if (failure.matcher.startsWith("compareGate:")) return true;
		return false;
	}
	return rubricCheckSpecs(rubric).some((spec) => specFailed([failure], spec));
}

function leftoverFailures(
	failures: AssertionFailure[],
	rubric: ScenarioRubric | undefined,
	compare: CompareStoryFields | undefined,
): AssertionFailure[] {
	return failures.filter((failure) => !failureIsScored(failure, rubric, compare));
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
	const leftover = leftoverFailures(options.failures, options.rubric, compare);
	const outcome =
		!options.passed && leftover.length === 0 && options.failures.length > 0
			? []
			: describeOutcome({
					...options,
					failures: leftover.length === options.failures.length ? options.failures : leftover,
				});
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
								passed: arm.passed,
								judgeVerdicts: arm.judgeVerdicts,
							})),
							compare.gates,
						),
					),
				]
			: describeTraceHappened(options.trace);
	return {
		criteria: describeRubricChecks(options.rubric, options.compare),
		result,
		verdict: storyVerdict(result, outcome),
		sections: options.skipped ? undefined : buildStorySections(options),
	};
}
