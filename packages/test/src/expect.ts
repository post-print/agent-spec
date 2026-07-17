import {
	type AgentMessage,
	type AgentTrace,
	collapseTraceWhitespace,
	handsOnTierBeforeTools,
	inferReviewDepthFromText,
	inferRoutingFromText,
	routingBlockBeforeTools,
	type SkillContextMode,
} from "@post-print/agent-harness";

import { assertionFailure } from "./failures.js";
import type { AssertionFailure, ScenarioRubric } from "./types.js";

export interface RubricAssertOptions {
	/** How skills were loaded for this run — affects mustInvokeSkill strictness. */
	skillsMode?: SkillContextMode;
}

const REVIEW_DEPTH_PATTERNS: Record<NonNullable<ScenarioRubric["reviewDepth"]>, RegExp> = {
	quick: /\*\*Depth:\*\*\s*quick\b|\bReview\s·\s*[^·]+\s·\s*Quick\b/i,
	standard: /\*\*Depth:\*\*\s*standard\b|\bReview\s·\s*[^·]+\s·\s*Standard\b/i,
	thorough: /\*\*Depth:\*\*\s*thorough\b|\bReview\s·\s*[^·]+\s·\s*Thorough\b/i,
	full: /\*\*Depth:\*\*\s*full\b|\bReview\s·\s*[^·]+\s·\s*Full\b/i,
};

const FULL_MODE_CODE_REVIEW_PATTERNS = [
	/\bReview\s·\s*[^·]+\s·\s*(?:Quick|Standard|Thorough|Full)\b/i,
	/## Review synthesis/i,
] as const;
const FULL_MODE_GRILL_PATTERNS = [
	/\bBranch\s+\d+\s*[—–-]/i,
	/\bgrill\b/i,
	/\bpressure-test(?:ing)?\b/i,
] as const;
const FULL_MODE_CRYSTALLIZE_PATTERNS = [
	/\bcrystalliz(?:e|ing|ation)\b/i,
	/\bhalf-formed\b/i,
	/\bfuzzy\s+intent\b/i,
	/\bmirror(?:ed|ing)?\s+(?:the\s+)?(?:fuzzy\s+)?intent\b/i,
	/\bmight be assuming\b/i,
] as const;
const ROUTING_HEADING_PATTERN = /(?:^|\n)#+\s*Routing\b/m;
const ROUTING_BOLD_PATTERN = /\*\*Routing\*\*/;

function snippet(text: string, max = 200): string {
	const trimmed = text.replace(/\s+/g, " ").trim();
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max)}…`;
}

function lineContaining(haystack: string, needle: string): string | undefined {
	const lowerNeedle = needle.toLowerCase();
	for (const line of haystack.split("\n")) {
		if (line.toLowerCase().includes(lowerNeedle)) {
			return snippet(line.trim(), 240);
		}
	}
	return undefined;
}

function nearestMissLine(haystack: string, expected: string): string | undefined {
	const words = expected
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
	for (const word of words) {
		const hit = lineContaining(haystack, word);
		if (hit) {
			return hit;
		}
	}
	return undefined;
}

function beforeToolsSnippet(trace: AgentTrace): string | undefined {
	if (trace.assistantTextBeforeTools?.trim()) {
		return snippet(trace.assistantTextBeforeTools);
	}
	const first = trace.messages.find((m: AgentMessage) => m.role === "assistant");
	return first?.content ? snippet(first.content) : undefined;
}

export class TraceAssertion {
	private failures: AssertionFailure[] = [];

	constructor(
		private readonly trace: AgentTrace,
		private readonly options: RubricAssertOptions = {},
	) {}

	get ok(): boolean {
		return this.failures.length === 0;
	}

	get errors(): AssertionFailure[] {
		return [...this.failures];
	}

	private messageText(): string {
		return this.trace.messages.map((m: { content: string }) => m.content).join("");
	}

	private assertionHaystack(): string {
		return [
			this.messageText(),
			this.trace.prBody ?? "",
			this.trace.gitDiff ?? "",
			...this.trace.shellCommands,
			...Object.values(this.trace.artifacts),
		].join("\n");
	}

	private patternHaystack(): string {
		return collapseTraceWhitespace(this.assertionHaystack());
	}

	private push(matcher: string, message: string, evidence?: string): void {
		this.failures.push(assertionFailure(matcher, message, "rubric_miss", evidence));
	}

	toHaveTier(tier: ScenarioRubric["tier"]): this {
		if (!tier) {
			return this;
		}
		const actual = this.trace.routing?.tier;
		if (actual !== tier) {
			const routing = this.trace.routing ? JSON.stringify(this.trace.routing) : "undefined";
			const before = beforeToolsSnippet(this.trace);
			this.push(
				"toHaveTier",
				`expected tier ${tier}, got ${actual ?? "undefined"}`,
				before ? `routing=${routing}; beforeTools=${before}` : `routing=${routing}`,
			);
		}
		return this;
	}

	/** Hands-on chat: tier from structured routing or one-line announce in transcript. */
	toHaveHandsOnTier(tier: ScenarioRubric["tier"]): this {
		if (!tier) {
			return this;
		}
		const haystack = this.assertionHaystack();
		const actual = this.trace.routing?.tier ?? inferRoutingFromText(haystack)?.tier;
		if (actual !== tier) {
			const routing = this.trace.routing ? JSON.stringify(this.trace.routing) : "undefined";
			const before = beforeToolsSnippet(this.trace);
			this.push(
				"toHaveHandsOnTier",
				`expected hands-on tier ${tier}, got ${actual ?? "undefined"}`,
				before ? `routing=${routing}; beforeTools=${before}` : `routing=${routing}`,
			);
		}
		return this;
	}

	toHaveReviewDepth(depth: ScenarioRubric["reviewDepth"]): this {
		if (!depth) {
			return this;
		}
		const haystack = this.patternHaystack();
		const pattern = REVIEW_DEPTH_PATTERNS[depth];
		const inferred = inferReviewDepthFromText(haystack);
		if (!pattern.test(haystack) && inferred !== depth) {
			this.push(
				"toHaveReviewDepth",
				`expected review depth ${depth}, not found in trace output`,
				beforeToolsSnippet(this.trace),
			);
		}
		return this;
	}

	toHaveRunCommand(fragment: string): this {
		const hit = this.trace.shellCommands.some((cmd: string) => cmd.includes(fragment));
		if (!hit) {
			const listed = this.trace.shellCommands.slice(0, 10);
			const more =
				this.trace.shellCommands.length > 10
					? ` (+${this.trace.shellCommands.length - 10} more)`
					: "";
			this.push(
				"toHaveRunCommand",
				`expected shell command containing "${fragment}"`,
				listed.length > 0
					? `shellCommands=[${listed.map((c) => JSON.stringify(c)).join(", ")}]${more}`
					: "shellCommands=[]",
			);
		}
		return this;
	}

	/**
	 * Assert a tool was called. Spec is a name substring, or `name:argFragment`
	 * where argFragment must appear in JSON-serialized args.
	 */
	toHaveCalledTool(spec: string): this {
		if (!toolSpecMatches(this.trace.toolCalls, spec)) {
			this.push("toHaveCalledTool", `expected tool call matching "${spec}"`);
		}
		return this;
	}

	toHaveNotCalledTool(spec: string): this {
		if (toolSpecMatches(this.trace.toolCalls, spec)) {
			this.push("toHaveNotCalledTool", `forbidden tool call matching "${spec}"`);
		}
		return this;
	}

	/** Substring must appear in JSON args of a Read-family tool call. */
	toHaveReadPath(fragment: string): this {
		if (!readToolArgsContain(this.trace.toolCalls, fragment)) {
			this.push(
				"toHaveReadPath",
				`expected Read tool args containing "${fragment}"`,
				readToolArgsEvidence(this.trace.toolCalls),
			);
		}
		return this;
	}

	/** Substring must not appear in JSON args of any Read-family tool call. */
	toHaveNotReadPath(fragment: string): this {
		if (readToolArgsContain(this.trace.toolCalls, fragment)) {
			this.push(
				"toHaveNotReadPath",
				`forbidden Read tool args containing "${fragment}"`,
				readToolArgsEvidence(this.trace.toolCalls),
			);
		}
		return this;
	}

	toIncludeRoutingBlock(): this {
		const haystack = this.assertionHaystack();
		const collapsed = collapseTraceWhitespace(haystack);
		if (
			!haystack.includes("## Routing") &&
			!ROUTING_HEADING_PATTERN.test(haystack) &&
			!ROUTING_BOLD_PATTERN.test(collapsed)
		) {
			this.push(
				"toIncludeRoutingBlock",
				"expected trace to include ## Routing section",
				beforeToolsSnippet(this.trace),
			);
		}
		return this;
	}

	/** Hands-off PR: ## Routing must appear before the first tool call. */
	toHaveRoutingBlockBeforeTools(): this {
		if (!routingBlockBeforeTools(this.trace)) {
			this.push(
				"toHaveRoutingBlockBeforeTools",
				"expected ## Routing block in assistant output before the first tool call (agent-routing.md hands-off)",
				beforeToolsSnippet(this.trace),
			);
		}
		return this;
	}

	/** Hands-on chat: tier announce must appear before the first tool call. */
	toHaveHandsOnTierBeforeTools(tier: ScenarioRubric["tier"]): this {
		if (!tier) {
			return this;
		}
		if (!handsOnTierBeforeTools(this.trace, tier)) {
			this.push(
				"toHaveHandsOnTierBeforeTools",
				`expected hands-on tier ${tier} announced before the first tool call`,
				beforeToolsSnippet(this.trace),
			);
		}
		return this;
	}

	toHaveInvokedSkill(skillName: string): this {
		if (this.skillWasInvoked(skillName)) {
			return this;
		}
		const invoked = this.trace.skillsInvoked ?? [];
		this.push(
			"toHaveInvokedSkill",
			this.options.skillsMode === "full"
				? `expected agent to apply ${skillName} skill (read SKILL.md or follow skill session in transcript)`
				: `expected agent to read ${skillName} skill (SKILL.md)`,
			`skillsInvoked=[${invoked.join(", ")}]`,
		);
		return this;
	}

	private skillWasInvoked(skillName: string): boolean {
		const normalized = skillName.toLowerCase();
		const invoked = this.trace.skillsInvoked ?? [];
		if (invoked.some((name) => name.toLowerCase() === normalized)) {
			return true;
		}
		const haystack = this.patternHaystack();
		if (
			haystack.toLowerCase().includes(`.claude/skills/${normalized}/skill.md`) ||
			haystack.toLowerCase().includes(`.claude/skills/${normalized}/references/`)
		) {
			return true;
		}
		if (this.options.skillsMode !== "full") {
			return false;
		}
		const fullModePatterns: RegExp[] = [
			new RegExp(
				`\\b(?:invok(?:e|ing)|following|using|per|applied)\\s+(?:the\\s+)?${normalized}\\b`,
				"i",
			),
			new RegExp(`\\*\\*${normalized}\\*\\*`, "i"),
			new RegExp(`\\b${normalized}\\s+(?:skill|protocol|design tree)\\b`, "i"),
			new RegExp(`\\b${normalized}\\s+before implement\\b`, "i"),
		];
		if (normalized === "code-review") {
			fullModePatterns.push(...FULL_MODE_CODE_REVIEW_PATTERNS);
		}
		if (normalized === "grill") {
			fullModePatterns.push(...FULL_MODE_GRILL_PATTERNS);
		}
		if (normalized === "crystallize") {
			fullModePatterns.push(...FULL_MODE_CRYSTALLIZE_PATTERNS);
		}
		return fullModePatterns.some((pattern) => pattern.test(haystack));
	}

	/** Which full-mode fallback pattern matched (for mustNotInvokeSkill evidence). */
	private skillMatchHint(skillName: string): string | undefined {
		const normalized = skillName.toLowerCase();
		const invoked = this.trace.skillsInvoked ?? [];
		if (invoked.some((name) => name.toLowerCase() === normalized)) {
			return `skillsInvoked includes ${skillName}`;
		}
		const haystack = this.patternHaystack();
		if (haystack.toLowerCase().includes(`.claude/skills/${normalized}/skill.md`)) {
			return "matched SKILL.md path in transcript";
		}
		return `skillsInvoked=[${invoked.join(", ")}]`;
	}

	toHaveNotInvokedSkill(skillName: string): this {
		if (!this.skillWasInvoked(skillName)) {
			return this;
		}
		this.push(
			"toHaveNotInvokedSkill",
			`expected agent not to invoke ${skillName} skill`,
			this.skillMatchHint(skillName),
		);
		return this;
	}

	mustInclude(text: string): this {
		const haystack = this.assertionHaystack();
		if (!haystack.toLowerCase().includes(text.toLowerCase())) {
			const near = nearestMissLine(haystack, text);
			this.push(
				"mustInclude",
				`expected text not found: "${text}"`,
				near ? `nearest: ${near}` : undefined,
			);
		}
		return this;
	}

	mustNotInclude(text: string): this {
		const haystack = this.assertionHaystack();
		if (containsForbiddenPhrase(haystack, text)) {
			this.push(
				"mustNotInclude",
				`forbidden text present: "${text}"`,
				lineContaining(haystack, text),
			);
		}
		return this;
	}
}

function containsForbiddenPhrase(haystack: string, phrase: string): boolean {
	const lowerPhrase = phrase.toLowerCase();
	if (lowerPhrase.includes(" ")) {
		const escaped = lowerPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
		return new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, "i").test(haystack);
	}
	const pattern = new RegExp(`\\b${lowerPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	return pattern.test(haystack);
}

function parseToolSpec(spec: string): { name: string; argFragment?: string } {
	const separator = spec.indexOf(":");
	if (separator === -1) {
		return { name: spec };
	}
	return {
		name: spec.slice(0, separator),
		argFragment: spec.slice(separator + 1),
	};
}

function toolSpecMatches(toolCalls: AgentTrace["toolCalls"], spec: string): boolean {
	const { name, argFragment } = parseToolSpec(spec);
	const nameNeedle = name.toLowerCase();
	return toolCalls.some((call) => {
		if (!call.name.toLowerCase().includes(nameNeedle)) {
			return false;
		}
		if (argFragment === undefined || argFragment.length === 0) {
			return true;
		}
		const argsText = JSON.stringify(call.args ?? {}).toLowerCase();
		return argsText.includes(argFragment.toLowerCase());
	});
}

function isReadToolName(name: string): boolean {
	return name.toLowerCase().includes("read");
}

function readToolCalls(toolCalls: AgentTrace["toolCalls"]): AgentTrace["toolCalls"] {
	return toolCalls.filter((call) => isReadToolName(call.name));
}

function readToolArgsContain(toolCalls: AgentTrace["toolCalls"], fragment: string): boolean {
	const needle = fragment.toLowerCase();
	return readToolCalls(toolCalls).some((call) =>
		JSON.stringify(call.args ?? {})
			.toLowerCase()
			.includes(needle),
	);
}

function readToolArgsEvidence(toolCalls: AgentTrace["toolCalls"]): string {
	const reads = readToolCalls(toolCalls);
	if (reads.length === 0) {
		return "Read toolCalls=[]";
	}
	const listed = reads.slice(0, 8).map((call) => {
		const args = JSON.stringify(call.args ?? {});
		return `${call.name}:${args.length > 120 ? `${args.slice(0, 120)}…` : args}`;
	});
	const more = reads.length > 8 ? ` (+${reads.length - 8} more)` : "";
	return `Read toolCalls=[${listed.join("; ")}]${more}`;
}

export function expectTrace(trace: AgentTrace, options?: RubricAssertOptions): TraceAssertion {
	return new TraceAssertion(trace, options);
}

export function assertRubric(
	trace: AgentTrace,
	rubric: ScenarioRubric,
	options?: RubricAssertOptions,
): AssertionFailure[] {
	const assertion = expectTrace(trace, options);
	if (rubric.tier) {
		if (rubric.handsOnRouting) {
			assertion.toHaveHandsOnTier(rubric.tier);
			assertion.toHaveHandsOnTierBeforeTools(rubric.tier);
		} else {
			assertion.toHaveTier(rubric.tier);
		}
	}
	if (rubric.reviewDepth) {
		assertion.toHaveReviewDepth(rubric.reviewDepth);
	}
	if (rubric.routingBlock) {
		assertion.toIncludeRoutingBlock();
		assertion.toHaveRoutingBlockBeforeTools();
	}
	for (const skill of rubric.mustInvokeSkill ?? []) {
		assertion.toHaveInvokedSkill(skill);
	}
	for (const skill of rubric.mustNotInvokeSkill ?? []) {
		assertion.toHaveNotInvokedSkill(skill);
	}
	for (const cmd of rubric.mustRun ?? []) {
		assertion.toHaveRunCommand(cmd);
	}
	for (const tool of rubric.mustCallTool ?? []) {
		assertion.toHaveCalledTool(tool);
	}
	for (const tool of rubric.mustNotCallTool ?? []) {
		assertion.toHaveNotCalledTool(tool);
	}
	for (const pathFragment of rubric.mustReadPath ?? []) {
		assertion.toHaveReadPath(pathFragment);
	}
	for (const pathFragment of rubric.mustNotReadPath ?? []) {
		assertion.toHaveNotReadPath(pathFragment);
	}
	for (const required of rubric.must ?? []) {
		assertion.mustInclude(required);
	}
	for (const forbidden of rubric.mustNot ?? []) {
		assertion.mustNotInclude(forbidden);
	}
	return assertion.errors;
}
