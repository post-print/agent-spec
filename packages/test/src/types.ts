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
	/** Substring that must not appear in assistant text, commands, artifacts, or tool args. Tool results are ignored. */
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

export type CompareArmId = "a" | "b";

/** Overrides for one side of a compare scenario. Omitted fields inherit the scenario. */
export interface CompareArm {
	label?: string;
	prompt?: string;
	host?: AgentHost;
	profile?: ContextProfile;
	workspace?: string;
	skills?: SkillContextSetting;
	contextSources?: string[];
	mcpServers?: Record<string, McpServerConfig>;
	allowUserSkills?: boolean;
	seedPatch?: string;
	seedStageOnly?: boolean;
	/**
	 * Extra deterministic checks for this arm only.
	 * Arrays append onto the scenario rubric. Do not set judge here.
	 */
	rubric?: ScenarioRubric;
}

/**
 * Two live arms in one scenario.
 * `faster` and `cheaper` are optional metric gates.
 * `rubric.judge` is optional and scores both transcripts.
 */
export interface ScenarioCompare {
	a: CompareArm;
	b: CompareArm;
	/** Named arm must have a shorter duration. */
	faster?: CompareArmId;
	/** Named arm must use fewer total tokens. */
	cheaper?: CompareArmId;
}

export interface CompareArmResult {
	id: CompareArmId;
	label: string;
	prompt: string;
	trace?: AgentTrace;
	durationMs?: number;
}

export interface ScenarioCompareResult {
	a: CompareArmResult;
	b: CompareArmResult;
}

export interface AgentScenario {
	name: string;
	/** Run two arms. Optional metric gates and an optional pairwise judge. */
	compare?: ScenarioCompare;
	prompt: string;
	host?: AgentHost;
	profile?: ContextProfile;
	/** Extra skill folders to overlay. Project skills in the git repo load without this. */
	skills?: SkillContextSetting;
	/** Additive context paths (merged after suite defaults.contextSources). */
	contextSources?: string[];
	/** Inline MCP servers for live Cursor (merged over suite defaults by server name). */
	mcpServers?: Record<string, McpServerConfig>;
	/**
	 * Caller-relative folder that becomes the sealed repo.
	 * Omit or `"."` copies caller HEAD. A subfolder copies only that tree.
	 */
	workspace?: string;
	/**
	 * Load host-global user skills from the developer machine.
	 * Default false. Keep false for a custom `workspace` fixture.
	 */
	allowUserSkills?: boolean;
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
	/**
	 * Caller-relative folder that becomes the sealed repo.
	 * Scenario `workspace` wins when both are set.
	 */
	workspace?: string;
	/**
	 * Load host-global user skills from the developer machine.
	 * Default false. Scenario `allowUserSkills` wins when both are set.
	 */
	allowUserSkills?: boolean;
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

/** CLI and HTML summary of rubric checks and what the run produced. */
export interface ScenarioStory {
	criteria: string[];
	result: string[];
	/** Failures and judge notes. Shown under Result. */
	verdict: string[];
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
	/** Agent + judge + total token usage when reported. */
	usage?: ScenarioUsageBreakdown;
	/** Denormalized agent-run usage. */
	agentUsage?: AgentUsage;
	/** Denormalized judge usage (sum of criteria). */
	judgeUsage?: AgentUsage;
	/** Scenario prompt sent to the host (for HTML conversation). */
	prompt?: string;
	/** Full agent transcript when available (for HTML reports / debug bundles). */
	trace?: AgentTrace;
	/** Both arms when this scenario is a compare run. */
	compare?: ScenarioCompareResult;
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
