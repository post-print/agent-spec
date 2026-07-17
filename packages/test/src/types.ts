import type {
	AgentHost,
	AgentTrace,
	AgentUsage,
	ContextProfile,
	McpServerConfig,
	SkillContextSetting,
} from "@post-print/agent-harness";

export type { AgentUsage, McpServerConfig } from "@post-print/agent-harness";

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
	/**
	 * Substring that must appear in a Read tool's JSON args (registry-first / path grounding).
	 * Hallucination scoring stays in live `judge` questions — these are lightweight proxies.
	 */
	mustReadPath?: string[];
	/** Substring that must not appear in any Read tool's JSON args. */
	mustNotReadPath?: string[];
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
	/** Additive context paths (merged after suite defaults.contextSources). */
	contextSources?: string[];
	/** Inline MCP servers for live Cursor (merged over suite defaults by server name). */
	mcpServers?: Record<string, McpServerConfig>;
	/** Live-only: apply patch + commit in worktree so pr-mode branch diff exists. */
	seedPatch?: string;
	/** Live-only: with seedPatch, stage changes without committing (staged review mode). */
	seedStageOnly?: boolean;
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
		/**
		 * Additive repo-relative context paths (or `.skeleton/customize/` basenames).
		 * Use with `profile: "skeleton"` or to extend shared/cursor/claude profiles.
		 */
		contextSources?: string[];
		/** Inline MCP servers for live Cursor runs. */
		mcpServers?: Record<string, McpServerConfig>;
	};
	scenarios: AgentScenario[];
}

export interface AssertionFailure {
	matcher: string;
	message: string;
	/** Normalized failure class for console, bundles, and CI consumers. */
	category: FailureCategory;
	/** Optional diagnostic detail (printed in --debug). */
	evidence?: string;
}

export type FailureCategory =
	| "rubric_miss"
	| "judge_infra"
	| "judge_parse"
	| "agent_runtime"
	| "worktree_leak"
	| "recording_error";

export interface JudgeVerdictResult {
	id: string;
	question: string;
	pass: boolean;
	rationale: string;
	infraError?: string;
	parseError?: string;
	rawSdkStatus?: string;
	sdkError?: { message?: string; code?: string };
	attempt?: number;
	transcriptChars?: number;
	promptChars?: number;
}

export interface ScenarioResult {
	suite: string;
	scenario: string;
	passed: boolean;
	failures: AssertionFailure[];
	skipped?: boolean;
	durationMs: number;
	/** Total live attempts including announce-stop retries (omit or 1 when no retry). */
	attempts?: number;
	/** LLM judge verdicts when judge criteria were evaluated. */
	judgeVerdicts?: JudgeVerdictResult[];
	/** Token usage when the host reported it (mirrored from trace.usage). */
	usage?: AgentUsage;
	/** Full agent transcript when available (for HTML reports / debug bundles). */
	trace?: AgentTrace;
	/** Absolute path to the debug bundle directory when --debug wrote one. */
	debugBundleDir?: string;
}

/** Aggregate token usage across scenarios that reported it. */
export interface UsageStats {
	scenariosWithUsage: number;
	sumTotalTokens?: number;
	p50TotalTokens?: number;
	p95TotalTokens?: number;
	sumInputTokens?: number;
	sumOutputTokens?: number;
}

export interface RunSummary {
	infraFailures: number;
	rubricFailures: number;
	agentRuntimeFailures: number;
	worktreeLeaks: number;
	recordingErrors: number;
	judgeParseFailures: number;
	/** Scenarios where the LLM judge used more than one attempt. */
	retriedScenarios: number;
	/** Scenarios where announce-stop scenario retry re-ran the agent. */
	scenarioRetriedScenarios: number;
	usage?: UsageStats;
}

export interface SuiteRunReport {
	suite: string;
	host: AgentHost;
	passed: number;
	failed: number;
	skipped: number;
	results: ScenarioResult[];
	summary?: RunSummary;
}
