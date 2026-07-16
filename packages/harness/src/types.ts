export type AgentHost = "cursor" | "claude" | "replay";

import type { RoutingContract } from "./routing-contract.js";
import type { SkillContextMode } from "./skills-context.js";

export type { RoutingContract } from "./routing-contract.js";

export type { SkillContextMode, SkillContextOptions, SkillContextSetting } from "./skills-context.js";

/** Which entry router to inject alongside shared skills context. */
export type ContextProfile = "shared" | "cursor" | "claude";

export interface AgentMessage {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
}

export interface AgentToolCall {
	name: string;
	args?: Record<string, unknown>;
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
	/** Live SDK: assistant prose before the first tool call. Replay: omit (all messages[] precede toolCalls[]). */
	assistantTextBeforeTools?: string;
	judgeVerdicts?: Array<{
		id: string;
		pass: boolean;
		rationale: string;
	}>;
	raw?: unknown;
}

export interface LoadedContext {
	profile: ContextProfile;
	cwd: string;
	/** Repo-relative paths loaded for the agent prompt preamble. */
	sources: string[];
	preamble: string;
	/** Skill catalog / full SKILL.md loading mode when enabled. */
	skillsMode?: SkillContextMode;
}

export interface RunAgentOptions {
	host: AgentHost;
	cwd: string;
	context: LoadedContext;
	prompt: string;
	/** Live dogfood: rubric-derived hands-off ## Routing contract (not the user prompt). */
	outputContract?: RoutingContract;
	/** Required when host is replay. */
	replayTracePath?: string;
	/** Hard cap on live Cursor stream + wait (replay ignores). */
	timeoutMs?: number;
	/** Fail fast when the agent invokes AskQuestion-style tools (default true for live). */
	failOnUserInput?: boolean;
	env?: Record<string, string>;
}

export type RunStatus = "completed" | "failed" | "skipped";

export interface AgentSession {
	host: AgentHost;
	status: RunStatus;
	trace: AgentTrace;
	durationMs: number;
	error?: string;
}

export interface HostAdapter {
	readonly host: AgentHost;
	run(options: RunAgentOptions): Promise<AgentSession>;
}
