import {
	type AgentTrace,
	collapseTraceWhitespace,
	handsOnTierBeforeTools,
	inferRoutingFromText,
	routingBlockBeforeTools,
	type SkillContextMode,
} from "@post-print/agent-harness";

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
	/(?:^|\n)\s*\d+\.\s+.+(?:\n\s*\d+\.\s+.+)+/m,
	/\b\d+\.\s+\S+(?:\s+\d+\.\s+\S+)+\b/,
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

	toHaveTier(tier: ScenarioRubric["tier"]): this {
		if (!tier) {
			return this;
		}
		const actual = this.trace.routing?.tier;
		if (actual !== tier) {
			this.failures.push({
				matcher: "toHaveTier",
				message: `expected tier ${tier}, got ${actual ?? "undefined"}`,
			});
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
			this.failures.push({
				matcher: "toHaveHandsOnTier",
				message: `expected hands-on tier ${tier}, got ${actual ?? "undefined"}`,
			});
		}
		return this;
	}

	toHaveReviewDepth(depth: ScenarioRubric["reviewDepth"]): this {
		if (!depth) {
			return this;
		}
		const pattern = REVIEW_DEPTH_PATTERNS[depth];
		if (!pattern.test(this.patternHaystack())) {
			this.failures.push({
				matcher: "toHaveReviewDepth",
				message: `expected review depth ${depth}, not found in trace output`,
			});
		}
		return this;
	}

	toHaveRunCommand(fragment: string): this {
		const hit = this.trace.shellCommands.some((cmd: string) => cmd.includes(fragment));
		if (!hit) {
			this.failures.push({
				matcher: "toHaveRunCommand",
				message: `expected shell command containing "${fragment}"`,
			});
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
			this.failures.push({
				matcher: "toIncludeRoutingBlock",
				message: "expected trace to include ## Routing section",
			});
		}
		return this;
	}

	/** Hands-off PR: ## Routing must appear before the first tool call. */
	toHaveRoutingBlockBeforeTools(): this {
		if (!routingBlockBeforeTools(this.trace)) {
			this.failures.push({
				matcher: "toHaveRoutingBlockBeforeTools",
				message:
					"expected ## Routing block in assistant output before the first tool call (agent-routing.md hands-off)",
			});
		}
		return this;
	}

	/** Hands-on chat: tier announce must appear before the first tool call. */
	toHaveHandsOnTierBeforeTools(tier: ScenarioRubric["tier"]): this {
		if (!tier) {
			return this;
		}
		if (!handsOnTierBeforeTools(this.trace, tier)) {
			this.failures.push({
				matcher: "toHaveHandsOnTierBeforeTools",
				message: `expected hands-on tier ${tier} announced before the first tool call`,
			});
		}
		return this;
	}

	toHaveInvokedSkill(skillName: string): this {
		if (this.skillWasInvoked(skillName)) {
			return this;
		}
		this.failures.push({
			matcher: "toHaveInvokedSkill",
			message:
				this.options.skillsMode === "full"
					? `expected agent to apply ${skillName} skill (read SKILL.md or follow skill session in transcript)`
					: `expected agent to read ${skillName} skill (SKILL.md)`,
		});
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

	toHaveNotInvokedSkill(skillName: string): this {
		if (!this.skillWasInvoked(skillName)) {
			return this;
		}
		this.failures.push({
			matcher: "toHaveNotInvokedSkill",
			message: `expected agent not to invoke ${skillName} skill`,
		});
		return this;
	}

	mustInclude(text: string): this {
		const haystack = this.assertionHaystack();
		if (!haystack.toLowerCase().includes(text.toLowerCase())) {
			this.failures.push({
				matcher: "mustInclude",
				message: `expected text not found: "${text}"`,
			});
		}
		return this;
	}

	mustNotInclude(text: string): this {
		const haystack = this.assertionHaystack();
		if (containsForbiddenPhrase(haystack, text)) {
			this.failures.push({
				matcher: "mustNotInclude",
				message: `forbidden text present: "${text}"`,
			});
		}
		return this;
	}
}

function containsForbiddenPhrase(haystack: string, phrase: string): boolean {
	const lowerHaystack = haystack.toLowerCase();
	const lowerPhrase = phrase.toLowerCase();
	if (lowerPhrase.includes(" ")) {
		return lowerHaystack.includes(lowerPhrase);
	}
	const pattern = new RegExp(`\\b${lowerPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
	return pattern.test(haystack);
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
	for (const required of rubric.must ?? []) {
		assertion.mustInclude(required);
	}
	for (const forbidden of rubric.mustNot ?? []) {
		assertion.mustNotInclude(forbidden);
	}
	return assertion.errors;
}
