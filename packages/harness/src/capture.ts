import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { textBlocksFromSdkMessage } from "./cursor-run.js";
import type { AgentMessage, AgentToolCall, AgentTrace } from "./types.js";

const execFileAsync = promisify(execFile);

const SHELL_COMMAND_PATTERN = /\b(bun run [\w:./-]+|validate:changed[\w ./:-]*|bunx [\w ./:-]+)/gi;

const TIER_PATTERN = /\*\*Tier:\*\*\s*(low|medium|high)\b/i;
const TIER_INLINE_PATTERN = /\bTier:\s*(low|medium|high)\b/i;
/** Hands-on one-line announce: "Medium — fuzzy intent" (em/en dash only, not hyphenated words) */
const TIER_LEADING_WORD_PATTERN = /\b(Low|Medium|High)\s*[—–]/i;
/** Hands-on inline: "**Routing:** Medium", "Routing: Medium", "Routing: **Low**" */
const ROUTING_LABEL_TIER_PATTERN =
	/\*\*Routing:\*\*\s*(?:\*\*)?(Low|Medium|High)\b|\bRouting:\s*(?:\*\*)?(Low|Medium|High)\b/i;

const HANDS_ON_TIER_PATTERNS = [
	TIER_PATTERN,
	TIER_INLINE_PATTERN,
	TIER_LEADING_WORD_PATTERN,
	ROUTING_LABEL_TIER_PATTERN,
] as const;

function tierFromMatch(match: RegExpMatchArray): "low" | "medium" | "high" | undefined {
	const raw = match[1] ?? match[2];
	const tier = raw?.toLowerCase() as "low" | "medium" | "high" | undefined;
	if (tier === "low" || tier === "medium" || tier === "high") {
		return tier;
	}
	return undefined;
}

/** Collect git diff after a live agent run. */
export async function captureGitDiff(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["diff", "HEAD"], { cwd, maxBuffer: 10_000_000 });
		const trimmed = stdout.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	} catch {
		return undefined;
	}
}

/** Extract shell commands from structured tool call args (Cursor SDK shell tools). */
export function extractShellCommandsFromToolCalls(toolCalls: AgentToolCall[]): string[] {
	const commands = new Set<string>();
	for (const call of toolCalls) {
		if (!call.args) {
			continue;
		}
		const candidates = [call.args.command, call.args.cmd, call.args.script, call.args.input];
		for (const raw of candidates) {
			if (typeof raw !== "string") {
				continue;
			}
			for (const cmd of extractShellCommands(raw)) {
				commands.add(cmd);
			}
			if (raw.includes("validate:changed") || raw.startsWith("bun run")) {
				commands.add(raw.trim());
			}
		}
	}
	return [...commands];
}

const SKILL_WORKFLOW_PATH_PATTERN = /\.claude\/skills\/([^/]+)\/(?:SKILL\.md|references\/)/i;

const APPLIED_SKILL_GENERIC_PATTERNS = [
	/\b(?:invok(?:e|ing)|following|using|per|walk(?:ing)?)\s+(?:the\s+)?([a-z][a-z0-9-]*)\s+(?:skill|protocol|design tree)\b/gi,
	/\*\*([a-z][a-z0-9-]*)\*\*\s*(?:skill|protocol)?/gi,
] as const;

const APPLIED_SKILL_MARKERS = [
	{ skill: "grill", pattern: /\bgrill\s+before\s+implement/i },
	{ skill: "grill", pattern: /\b(?:invok(?:e|ing)|applied)\s+grill\b/i },
	{ skill: "grill", pattern: /\bgrill\b/i },
	{ skill: "grill", pattern: /\bpressure-test(?:ing)?\b/i },
	{ skill: "grill", pattern: /(?:^|\n)\s*\d+\.\s+.+(?:\n\s*\d+\.\s+.+)+/m },
	{ skill: "grill", pattern: /\b\d+\.\s+\S+(?:\s+\d+\.\s+\S+)+\b/ },
	{ skill: "crystallize", pattern: /\b(?:invok(?:e|ing)|applied)\s+crystallize\b/i },
	{ skill: "crystallize", pattern: /\bcrystalliz(?:e|ing|ation)\b/i },
	{ skill: "crystallize", pattern: /\bhalf-formed\b/i },
	{ skill: "crystallize", pattern: /\bfuzzy\s+intent\b/i },
	{ skill: "crystallize", pattern: /\bmirror(?:ed|ing)?\s+(?:the\s+)?(?:fuzzy\s+)?intent\b/i },
	{ skill: "crystallize", pattern: /\bmight be assuming\b/i },
	{ skill: "code-review", pattern: /\b(?:invok(?:e|ing)|applied)\s+code-review\b/i },
	{
		skill: "code-review",
		pattern: /\bReview\s·\s*[^·]+\s·\s*(?:Quick|Standard|Thorough|Full)\b/i,
	},
	{ skill: "code-review", pattern: /## Review synthesis/i },
] as const;

const REVIEW_HEADER_DEPTH_PATTERN = /\bReview\s·\s*[^·]+\s·\s*(Quick|Standard|Thorough|Full)\b/i;
const REVIEW_DEPTH_LABEL_PATTERN = /\*\*Depth:\*\*\s*(quick|standard|thorough|full)\b/i;

/** Collapse whitespace so SDK token-chunked assistant prose still matches rubric patterns. */
export function collapseTraceWhitespace(text: string): string {
	return text.replace(/\s+/g, " ");
}

function pathsFromToolArgs(args: Record<string, unknown>): string[] {
	const paths: string[] = [];
	for (const key of ["path", "file_path", "filePath", "target_file", "uri"]) {
		const value = args[key];
		if (typeof value === "string") {
			paths.push(value);
		}
	}
	return paths;
}

function skillNameFromPath(path: string): string | undefined {
	const match = path.match(SKILL_WORKFLOW_PATH_PATTERN);
	return match?.[1]?.toLowerCase();
}

/** Infer skill folder names from Read tool paths in tool calls. */
export function extractSkillsInvokedFromToolCalls(toolCalls: AgentToolCall[]): string[] {
	const skills = new Set<string>();
	for (const call of toolCalls) {
		if (!call.args) {
			continue;
		}
		for (const path of pathsFromToolArgs(call.args)) {
			const name = skillNameFromPath(path);
			if (name) {
				skills.add(name);
			}
		}
		const serialized = JSON.stringify(call.args);
		for (const match of serialized.matchAll(/\.claude\/skills\/([^/]+)\/SKILL\.md/gi)) {
			const name = match[1]?.toLowerCase();
			if (name) {
				skills.add(name);
			}
		}
	}
	return [...skills];
}

/** Infer skill reads referenced in assistant prose. */
export function extractSkillsInvokedFromText(...chunks: string[]): string[] {
	const skills = new Set<string>();
	for (const chunk of chunks) {
		for (const match of chunk.matchAll(/\.claude\/skills\/([^/]+)\/SKILL\.md/gi)) {
			const name = match[1]?.toLowerCase();
			if (name) {
				skills.add(name);
			}
		}
	}
	return [...skills];
}

/** Infer explicit skill sessions when SKILL.md is already in preamble (full catalog mode). */
export function extractSkillsAppliedFromText(...chunks: string[]): string[] {
	const skills = new Set<string>();
	const combined = collapseTraceWhitespace(chunks.join("\n"));

	const genericPatterns = APPLIED_SKILL_GENERIC_PATTERNS;
	for (const pattern of genericPatterns) {
		for (const match of combined.matchAll(pattern)) {
			const name = match[1]?.toLowerCase();
			if (name) {
				skills.add(name);
			}
		}
	}

	for (const { skill, pattern } of APPLIED_SKILL_MARKERS) {
		if (pattern.test(combined)) {
			skills.add(skill);
		}
	}

	return [...skills];
}

/** Infer code-review depth from synthesis status line (`Review · staged · Standard`). */
export function inferReviewDepthFromText(
	text: string,
): "quick" | "standard" | "thorough" | "full" | undefined {
	const collapsed = collapseTraceWhitespace(text);
	const headerMatch = collapsed.match(REVIEW_HEADER_DEPTH_PATTERN);
	if (headerMatch?.[1]) {
		return headerMatch[1].toLowerCase() as "quick" | "standard" | "thorough" | "full";
	}
	const depthMatch = collapsed.match(REVIEW_DEPTH_LABEL_PATTERN);
	return depthMatch?.[1]?.toLowerCase() as "quick" | "standard" | "thorough" | "full" | undefined;
}

export function mergeSkillsInvoked(...lists: Array<string[] | undefined>): string[] {
	return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** Pull shell-like commands from assistant prose and tool output. */
export function extractShellCommands(...chunks: string[]): string[] {
	const commands = new Set<string>();
	for (const chunk of chunks) {
		for (const match of chunk.matchAll(SHELL_COMMAND_PATTERN)) {
			const cmd = match[0]?.trim();
			if (cmd) {
				commands.add(cmd);
			}
		}
	}
	return [...commands];
}

/** Infer routing metadata from live agent prose when not structured. */
/** Assistant prose before the first tool call (SDK order, or replay messages[]). */
export function assistantPrefixBeforeTools(trace: AgentTrace): string {
	if (trace.assistantTextBeforeTools !== undefined) {
		return trace.assistantTextBeforeTools;
	}
	return trace.messages
		.filter((message) => message.role === "assistant")
		.map((message) => message.content)
		.join("");
}

export function inferRoutingFromText(text: string): AgentTrace["routing"] | undefined {
	const collapsed = collapseTraceWhitespace(text);
	for (const pattern of HANDS_ON_TIER_PATTERNS) {
		const tierMatch = collapsed.match(pattern);
		if (!tierMatch) {
			continue;
		}
		const tier = tierFromMatch(tierMatch);
		if (tier) {
			return { tier, signals: ["inferred from live transcript"] };
		}
	}
	return undefined;
}

export function inferPrBodyFromText(text: string): string | undefined {
	const routingIndex = text.indexOf("## Routing");
	if (routingIndex === -1) {
		return undefined;
	}
	return text.slice(routingIndex).trim();
}

const ROUTING_HEADING_BEFORE_TOOLS = /(?:^|\n)#+\s*Routing\b/m;
const ROUTING_BOLD_PATTERN = /\*\*Routing\*\*/;

/** Hands-off: ## Routing block appears in assistant text before the first tool call. */
export function routingBlockBeforeTools(trace: AgentTrace): boolean {
	const prefix = assistantPrefixBeforeTools(trace);
	if (trace.toolCalls.length === 0) {
		return toIncludeRoutingBlockText(`${prefix}\n${trace.prBody ?? ""}`);
	}
	return toIncludeRoutingBlockText(prefix);
}

function toIncludeRoutingBlockText(text: string): boolean {
	const collapsed = collapseTraceWhitespace(text);
	return (
		text.includes("## Routing") ||
		ROUTING_HEADING_BEFORE_TOOLS.test(text) ||
		ROUTING_BOLD_PATTERN.test(collapsed)
	);
}

/** Hands-on: tier announce appears in assistant text before the first tool call. */
export function handsOnTierBeforeTools(
	trace: AgentTrace,
	tier: NonNullable<AgentTrace["routing"]>["tier"],
): boolean {
	return inferRoutingFromText(assistantPrefixBeforeTools(trace))?.tier === tier;
}

export interface SdkTextBlock {
	type: string;
	text?: string;
}

export interface SdkToolPayload {
	name?: string;
	input?: unknown;
	output?: string;
}

export interface SdkMessage {
	type?: string;
	/** Cursor SDK tool_call — tool name at event root (read, shell, edit, …). */
	name?: string;
	args?: Record<string, unknown>;
	message?: {
		role?: string;
		content?: SdkTextBlock[];
	};
	tool?: SdkToolPayload;
}

function isToolRelatedEvent(event: SdkMessage): boolean {
	const type = event.type ?? "";
	return type.includes("tool") || Boolean(event.tool);
}

function toolCallFromEvent(event: SdkMessage): AgentToolCall | undefined {
	if (event.type === "tool_call" && event.name) {
		return { name: event.name, args: event.args };
	}

	const name = event.tool?.name ?? (event.type?.includes("tool") ? event.type : undefined);
	if (!name) {
		return undefined;
	}
	let args: Record<string, unknown> | undefined;
	if (event.tool?.input !== undefined && typeof event.tool.input === "object") {
		args = event.tool.input as Record<string, unknown>;
	} else if (typeof event.tool?.input === "string") {
		try {
			const parsed = JSON.parse(event.tool.input) as unknown;
			if (parsed && typeof parsed === "object") {
				args = parsed as Record<string, unknown>;
			}
		} catch {
			args = { command: event.tool.input };
		}
	}
	return { name, args };
}

export interface TraceAccumulator {
	agentMessages: AgentMessage[];
	inferenceChunks: string[];
	textChunks: string[];
	toolOutputChunks: string[];
	toolCalls: AgentToolCall[];
	preToolAssistantChunks: string[];
	hasSeenTool: boolean;
}

export function createTraceAccumulator(): TraceAccumulator {
	return {
		agentMessages: [],
		inferenceChunks: [],
		textChunks: [],
		toolOutputChunks: [],
		toolCalls: [],
		preToolAssistantChunks: [],
		hasSeenTool: false,
	};
}

/** Fold one SDK stream event into trace fields without retaining the raw event. */
export function accumulateSdkEvent(acc: TraceAccumulator, event: SdkMessage): void {
	const text = textBlocksFromSdkMessage(event);
	if (text) {
		acc.inferenceChunks.push(text);
	}
	if (event.type === "assistant" || event.message?.role === "assistant") {
		if (text) {
			acc.agentMessages.push({ role: "assistant", content: text });
			acc.textChunks.push(text);
			if (!acc.hasSeenTool) {
				acc.preToolAssistantChunks.push(text);
			}
		}
		return;
	}

	if (isToolRelatedEvent(event)) {
		if (text) {
			acc.toolOutputChunks.push(text);
		}
		const toolCall = toolCallFromEvent(event);
		if (toolCall) {
			acc.hasSeenTool = true;
			acc.toolCalls.push(toolCall);
		}
	}
}

export function finalizeTraceAccumulator(
	acc: TraceAccumulator,
	options?: { gitDiff?: string },
): AgentTrace {
	// Join stream token chunks with "" — "\n" breaks markdown like **Tier:** into
	// **\nTier\n:** which collapseTraceWhitespace cannot repair for regex matching.
	const combined = [
		...new Set([...acc.inferenceChunks, ...acc.textChunks, ...acc.toolOutputChunks]),
	].join("");
	const routing = inferRoutingFromText(combined);
	const prBody = inferPrBodyFromText(combined);
	const shellFromText = extractShellCommands(combined, ...acc.toolOutputChunks);
	const shellFromTools = extractShellCommandsFromToolCalls(acc.toolCalls);
	const skillsInvoked = mergeSkillsInvoked(
		extractSkillsInvokedFromToolCalls(acc.toolCalls),
		extractSkillsInvokedFromText(combined),
		extractSkillsAppliedFromText(combined),
	);

	return {
		messages: acc.agentMessages,
		toolCalls: acc.toolCalls,
		shellCommands: [...new Set([...shellFromText, ...shellFromTools])],
		skillsInvoked,
		gitDiff: options?.gitDiff,
		prBody,
		artifacts: {},
		routing,
		assistantTextBeforeTools: acc.preToolAssistantChunks.join(""),
	};
}

/** Normalize Cursor SDK messages into AgentTrace fields. */
export function buildTraceFromSdkMessages(
	messages: SdkMessage[],
	options?: { gitDiff?: string },
): AgentTrace {
	const acc = createTraceAccumulator();
	for (const event of messages) {
		accumulateSdkEvent(acc, event);
	}
	return finalizeTraceAccumulator(acc, options);
}

/** Fill routing / PR body from transcript when live runs omit structured fields. */
export function enrichTrace(trace: AgentTrace): AgentTrace {
	// Join stream token chunks with "" — see finalizeTraceAccumulator.
	const combined = [...trace.messages.map((m) => m.content), trace.prBody ?? ""].join("");

	return {
		...trace,
		routing: trace.routing ?? inferRoutingFromText(combined),
		prBody: trace.prBody ?? inferPrBodyFromText(combined),
		skillsInvoked: mergeSkillsInvoked(
			trace.skillsInvoked,
			extractSkillsInvokedFromToolCalls(trace.toolCalls),
			extractSkillsInvokedFromText(combined),
			extractSkillsAppliedFromText(combined),
		),
		shellCommands:
			trace.shellCommands.length > 0
				? trace.shellCommands
				: [
						...new Set([
							...extractShellCommands(combined, trace.gitDiff ?? ""),
							...extractShellCommandsFromToolCalls(trace.toolCalls),
						]),
					],
	};
}
