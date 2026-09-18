export const AGENT_HOSTS = ["cursor", "claude", "openai", "openrouter"] as const;
export type BuiltinAgentHost = (typeof AGENT_HOSTS)[number];
/** Builtin host or a registered consumer slug. */
export type AgentHost = BuiltinAgentHost | (string & {});

const HOST_SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export function isBuiltinAgentHost(value: string): value is BuiltinAgentHost {
	return (AGENT_HOSTS as readonly string[]).includes(value);
}

/** Lowercase slug: starts with a letter, then letters, digits, or hyphens. */
export function isHostSlug(value: string): boolean {
	return HOST_SLUG.test(value);
}

/** True for a builtin host id. Registered slugs use `isKnownAgentHost`. */
export function isAgentHost(value: string): value is AgentHost {
	return isBuiltinAgentHost(value);
}

export type { McpServerConfig } from "./mcp.js";
export type { RoutingContract } from "./routing-contract.js";

/** How workspace instructions reach the host for this run. */
export type ContextMode = "host-native" | "harness-preamble";

export type {
	SkillContextMode,
	SkillContextOptions,
	SkillContextSetting,
} from "./skills-context.js";

/** Which entry router to inject alongside shared skills context. */
export type ContextProfile = "shared" | "cursor" | "claude" | "skeleton";

export interface AgentMessage {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	/** Monotonic emission order shared with toolCalls, for chronological interleaving. Absent on legacy traces. */
	seq?: number;
}

export interface AgentToolCall {
	name: string;
	args?: Record<string, unknown>;
	/** Tool output when the SDK stream includes it (including MCP tools). */
	result?: string;
	/** Structured execution outcome when the host reports one. */
	succeeded?: boolean;
	/** Exact process exit code when the host reports one. */
	exitCode?: number;
	/** Monotonic emission order shared with messages, for chronological interleaving. Absent on legacy traces. */
	seq?: number;
}

/** Provider-reported token usage when the host SDK surfaces it. */
export interface AgentUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
}

export interface AgentTrace {
	messages: AgentMessage[];
	toolCalls: AgentToolCall[];
	shellCommands: string[];
	/** Skill folder names inferred from Read tool paths (e.g. grill, crystallize). */
	skillsInvoked?: string[];
	gitDiff?: string;
	prBody?: string;
	artifacts: Record<string, string>;
	routing?: {
		tier?: "low" | "medium" | "high";
		signals?: string[];
		invariantApplied?: string[];
		escalations?: string[];
	};
	/** Assistant prose before the first tool call when the host surfaces chronological events. */
	assistantTextBeforeTools?: string;
	/** Cumulative token usage when the host reported it. */
	usage?: AgentUsage;
	judgeVerdicts?: Array<{
		id: string;
		pass: boolean;
		rationale: string;
	}>;
	raw?: unknown;
}

export type LiveAgentEvent =
	| { type: "tool"; name: string; args?: Record<string, unknown> }
	| { type: "text"; text: string };
