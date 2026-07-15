import type {
	AgentHost,
	ContextProfile,
	McpServerConfig,
	SkillContextSetting,
} from "@post-print/agent-harness";

export type { McpServerConfig } from "@post-print/agent-harness";

export type JudgeRubricItem = string | { id?: string; question: string };

export interface ScenarioRubric {
	tier?: "low" | "medium" | "high";
	/** Chat-style tier announce — infer one-line routing from transcript when routing.tier absent. */
	handsOnRouting?: boolean;
	must?: string[];
	mustNot?: string[];
	mustRun?: string[];
	/**
	 * Tool name substring, or `name:argFragment` where argFragment must appear in JSON args.
	 * Matches built-in and MCP tool calls recorded on the trace.
	 */
	mustCallTool?: string[];
	mustNotCallTool?: string[];
	/** Skill folder names the agent must read via SKILL.md (e.g. grill, crystallize). */
	mustInvokeSkill?: string[];
	mustNotInvokeSkill?: string[];
	routingBlock?: boolean;
	reviewDepth?: "quick" | "standard" | "thorough" | "full";
	/** Fuzzy criteria — harness LLM judge on live runs only. */
	judge?: JudgeRubricItem[];
}

export interface AgentScenario {
	name: string;
	prompt: string;
	host?: AgentHost;
	profile?: ContextProfile;
	/** Override suite defaults for skill catalog loading. */
	skills?: SkillContextSetting;
	/** Inline MCP servers for live Cursor (merged over suite defaults by server name). */
	mcpServers?: Record<string, McpServerConfig>;
	/** Live-only: apply patch + commit in worktree so pr-mode branch diff exists. */
	seedPatch?: string;
	replayTrace?: string;
	rubric: ScenarioRubric;
	skip?: boolean;
}

export interface AgentSuiteFile {
	name: string;
	description?: string;
	defaults?: {
		host?: AgentHost;
		profile?: ContextProfile;
		/** none | catalog | full — ambient-routing uses full for IDE parity. */
		skills?: SkillContextSetting;
		/** Inline MCP servers for live Cursor runs. */
		mcpServers?: Record<string, McpServerConfig>;
	};
	scenarios: AgentScenario[];
}

export interface AssertionFailure {
	matcher: string;
	message: string;
}

export interface JudgeVerdictResult {
	id: string;
	question: string;
	pass: boolean;
	rationale: string;
}

export interface ScenarioResult {
	suite: string;
	scenario: string;
	passed: boolean;
	failures: AssertionFailure[];
	skipped?: boolean;
	durationMs: number;
	/** LLM judge verdicts when judge criteria were evaluated. */
	judgeVerdicts?: JudgeVerdictResult[];
}

export interface SuiteRunReport {
	suite: string;
	host: AgentHost;
	passed: number;
	failed: number;
	skipped: number;
	results: ScenarioResult[];
}
