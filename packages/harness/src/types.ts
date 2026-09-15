export const AGENT_HOSTS = ["cursor", "claude", "openai"] as const;
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

import type { HostAuthMode } from "./auth-mode.js";
import type { McpServerConfig } from "./mcp.js";
import type { RoutingContract } from "./routing-contract.js";
import type { SkillContextMode } from "./skills-context.js";

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

export interface LoadedContext {
	/** Host discovery only, or a runner-built prompt preamble. Absent means preamble compatibility. */
	mode?: ContextMode;
	profile: ContextProfile;
	cwd: string;
	/** Repo-relative paths loaded for the agent prompt preamble. Empty in host-native mode. */
	sources: string[];
	preamble: string;
	/** Skill catalog / full SKILL.md loading mode when enabled. */
	skillsMode?: SkillContextMode;
}

export type LiveAgentEvent =
	| { type: "tool"; name: string; args?: Record<string, unknown> }
	| { type: "text"; text: string };

export interface RunAgentOptions {
	host: AgentHost;
	cwd: string;
	context: LoadedContext;
	prompt: string;
	/** Live dogfood: rubric-derived hands-off ## Routing contract (not the user prompt). */
	outputContract?: RoutingContract;
	/** Inline MCP servers for direct agent runs. */
	mcpServers?: Record<string, McpServerConfig>;
	/** Hard cap on the direct agent stream + wait. */
	timeoutMs?: number;
	/** Fail fast when the agent invokes AskQuestion-style tools (default true for live). */
	failOnUserInput?: boolean;
	/** Max agent turns when failOnUserInput is false (default 6). */
	maxConversationTurns?: number;
	/** Fires when the live harness deadline clock starts (after pre-stream SDK setup). */
	onDeadlineStart?: () => void | Promise<void>;
	/** Fires as the host streams assistant text and tool calls. */
	onAgentEvent?: (event: LiveAgentEvent) => void;
	/**
	 * Load host-global user skills (`~/.cursor/skills-cursor`,
	 * `~/.cursor/skills`, `~/.claude/skills`, `~/.codex/skills`,
	 * `~/.agents/skills`). Default false.
	 */
	allowUserSkills?: boolean;
	/** Allow network access in an OpenAI Codex workspace-write sandbox. Default false. */
	networkAccess?: boolean;
	/** Host billing mode. Default is subscription when omitted. */
	authMode?: HostAuthMode;
	env?: Record<string, string>;
}

export type RunStatus = "completed" | "failed" | "skipped";

export interface AgentSession {
	host: AgentHost;
	status: RunStatus;
	trace: AgentTrace;
	durationMs: number;
	/** Agent-run token usage when the host reported it (mirrors trace.usage). */
	usage?: AgentUsage;
	error?: string;
}

export interface HostAdapter {
	readonly host: string;
	run(options: RunAgentOptions): Promise<AgentSession>;
	/** Missing credential or binary. Undefined when this host can run. */
	missingAuth?(): string | undefined;
	/** Builtin judge family when this adapter does not implement `classify`. */
	classifierHost?: BuiltinAgentHost;
	/** Optional judge/classifier. Use this or `classifierHost`. */
	classify?(options: { cwd: string; prompt: string; apiKey?: string }): Promise<{
		status: string;
		text: string;
		rawStatus?: string;
		usage?: AgentUsage;
	}>;
	/** Missing classifier auth. Undefined when the judge can run. */
	missingClassifierAuth?(): string | undefined;
}
