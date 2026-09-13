import type {
	AgentHost,
	AgentTrace,
	AgentUsage,
	ContextProfile,
	McpServerConfig,
	ScenarioUsageBreakdown,
	SkillContextSetting,
} from "@post-print/agent-harness";

export type {
	AgentUsage,
	McpServerConfig,
	ScenarioUsageBreakdown,
} from "@post-print/agent-harness";

export type JudgeRubricItem = string | { id?: string; question: string };

export interface ScenarioRubric {
	tier?: "low" | "medium" | "high";
	/** Chat-style tier announce — infer one-line routing from transcript when routing.tier absent. */
	handsOnRouting?: boolean;
	/** Substring in assistant text, commands, artifacts, or tool args and results. */
	must?: string[];
	mustNot?: string[];
	mustRun?: string[];
	/**
	 * Tool name substring, or `name:fragment` where fragment must appear in
	 * JSON args or the tool result. Matches built-in and MCP tool calls.
	 */
	mustCallTool?: string[];
	mustNotCallTool?: string[];
	/**
	 * Substring that must appear in Read-family args or a Shell/Bash path access.
	 * Hallucination scoring stays in live `judge` questions — these are lightweight proxies.
	 */
	mustReadPath?: string[];
	/** Substring that must not appear in any Read tool's JSON args. */
	mustNotReadPath?: string[];
	/**
	 * Skill folder names. Deterministic match is a SKILL.md / references read
	 * on a host skill path. Live judge then scores whether the agent followed it.
	 */
	mustInvokeSkill?: string[];
	mustNotInvokeSkill?: string[];
	routingBlock?: boolean;
	reviewDepth?: "quick" | "standard" | "thorough" | "full";
	/** Any transcript outcome. The judge sees assistant text, tool args, and tool results. */
	judge?: JudgeRubricItem[];
}

export interface AgentScenario {
	name: string;
	/** Stable key for full vs transfer arm comparison (optional). */
	compareId?: string;
	prompt: string;
	host?: AgentHost;
	profile?: ContextProfile;
	/** Extra skill folders to overlay. Project skills in the git repo load without this. */
	skills?: SkillContextSetting;
	/** Additive context paths (merged after suite defaults.contextSources). */
	contextSources?: string[];
	/** Inline MCP servers for live Cursor (merged over suite defaults by server name). */
	mcpServers?: Record<string, McpServerConfig>;
	/** Live-only: apply patch + commit in worktree so pr-mode branch diff exists. */
	seedPatch?: string;
	/** Live-only: with seedPatch, stage changes without committing (staged review mode). */
	seedStageOnly?: boolean;
	/**
	 * Assertions / judge criteria. May be omitted in scenarios.json when supplied via
	 * sibling `rubrics.json` / `scenarios.rubric.json` or `--rubrics-dir` (harness-only);
	 * `loadSuiteFile` always normalizes to an object.
	 */
	rubric: ScenarioRubric;
	skip?: boolean;
}

export interface AgentSuiteDefaults {
	host?: AgentHost;
	profile?: ContextProfile;
	/** Extra skill folders to overlay, or `"none"`. */
	skills?: SkillContextSetting;
	/** Additive repo-relative context paths or `.skeleton/customize/` basenames. */
	contextSources?: string[];
	/** Inline MCP servers for direct agent runs. */
	mcpServers?: Record<string, McpServerConfig>;
}

export interface AgentSuiteFile {
	name: string;
	description?: string;
	/**
	 * Host matrix for this suite (Playwright-style projects).
	 * When set, a run expands once per host. `--host` then filters the list.
	 */
	hosts?: AgentHost[];
	defaults?: AgentSuiteDefaults;
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
	usage?: AgentUsage;
}

/** CLI and HTML summary of what a scenario checked and what the agent did. */
export interface ScenarioStory {
	tested: string[];
	happened: string[];
	outcome: string[];
}

export interface ScenarioResult {
	suite: string;
	scenario: string;
	/** Stable compare key when scenario JSON defines compareId. */
	compareId?: string;
	passed: boolean;
	failures: AssertionFailure[];
	skipped?: boolean;
	durationMs: number;
	/** Total live attempts including announce-stop retries (omit or 1 when no retry). */
	attempts?: number;
	/** LLM judge verdicts when judge criteria were evaluated. */
	judgeVerdicts?: JudgeVerdictResult[];
	/** Agent + judge + total token usage when reported. */
	usage?: ScenarioUsageBreakdown;
	/** Denormalized agent-run usage. */
	agentUsage?: AgentUsage;
	/** Denormalized judge usage (sum of criteria). */
	judgeUsage?: AgentUsage;
	/** Full agent transcript when available (for HTML reports / debug bundles). */
	trace?: AgentTrace;
	/** Plain-language summary of the check, the agent run, and the verdict. */
	story?: ScenarioStory;
	/** Absolute path to the debug bundle directory when --debug wrote one. */
	debugBundleDir?: string;
}

/** Aggregate token usage across scenarios that reported it. */
export interface UsageStats {
	scenariosWithUsage: number;
	sumTotalTokens?: number;
	p50TotalTokens?: number;
	p95TotalTokens?: number;
	maxTotalTokens?: number;
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
