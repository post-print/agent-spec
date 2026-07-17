import { createAdapter } from "./adapters/index.js";
import { loadContext } from "./context.js";
import type { AgentSession, ContextProfile, RunAgentOptions } from "./types.js";

export {
	ClaudeAdapter,
	CursorAdapter,
	createAdapter,
	ReplayAdapter,
} from "./adapters/index.js";
export type { SdkMessage } from "./capture.js";
export {
	assistantPrefixBeforeTools,
	buildTraceFromSdkMessages,
	captureGitDiff,
	collapseTraceWhitespace,
	enrichTrace,
	extractShellCommands,
	extractShellCommandsFromToolCalls,
	extractSkillsAppliedFromText,
	extractSkillsInvokedFromText,
	extractSkillsInvokedFromToolCalls,
	handsOnTierBeforeTools,
	inferReviewDepthFromText,
	inferRoutingFromText,
	mergeAgentUsage,
	mergeSkillsInvoked,
	normalizeAgentUsage,
	routingBlockBeforeTools,
} from "./capture.js";
export {
	type LoadContextOptions,
	loadContext,
	parseSkeletonAlwaysInclude,
	summarizeSkeletonConfig,
} from "./context.js";
export {
	assistantTextFromSdkMessages,
	type CursorRunOptions,
	type CursorRunResult,
	cancelActiveCursorRun,
	formatCursorRunFailure,
	type JudgeClassifierOptions,
	type JudgeClassifierResult,
	type JudgeSdkError,
	runCursorAgent,
	runJudgeClassifier,
	takeLastCursorRunTrace,
	textBlocksFromSdkMessage,
} from "./cursor-run.js";
export {
	type JudgeCriterion,
	type JudgeTraceOptions,
	type JudgeTraceResult,
	type JudgeVerdict,
	judgeTrace,
	type ParsedJudgeJson,
	parseJudgeJsonResponse,
	parseJudgeLegacyResponse,
	parseJudgeResponse,
} from "./judge.js";
export { type Logger, type LogLevel, logger } from "./logger.js";
export {
	getHealthStatus,
	HEALTH_CHECK_PATH,
	type HealthStatus,
} from "./main.js";
export {
	expandEnvPlaceholders,
	mergeMcpServers,
	resolveMcpServers,
} from "./mcp.js";
export {
	isTransientInfraError,
	resolveRetryMaxAttempts,
	withRetry,
} from "./retry.js";
export { buildRoutingContract } from "./routing-contract.js";
export {
	AgentRunTimeoutError,
	getPartialTrace,
	isUserInputTool,
	type PartialTraceCarrier,
	type RunTimeoutOptions,
	traceHasUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "./run-guards.js";
export {
	loadSkillContext,
	normalizeSkillContext,
	type SkillCatalogEntry,
} from "./skills-context.js";
export type {
	AgentHost,
	AgentMessage,
	AgentSession,
	AgentToolCall,
	AgentTrace,
	AgentUsage,
	ContextProfile,
	HostAdapter,
	LoadedContext,
	McpServerConfig,
	RoutingContract,
	RunAgentOptions,
	RunStatus,
	SkillContextMode,
	SkillContextOptions,
	SkillContextSetting,
} from "./types.js";
export {
	captureWorkingTreeStatus,
	filterWorkingTreeLeaks,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
	isPathUnderRoot,
	normalizePorcelainStatus,
	porcelainPathFromStatusLine,
	resolveHarnessArtifactIgnoreRoots,
	restoreWorkingTreePaths,
} from "./working-tree-guard.js";
export {
	cleanupStaleScenarioWorktrees,
	createScenarioWorktree,
	SCENARIO_WORKTREE_DIR_PREFIX,
	type ScenarioWorktree,
} from "./worktree.js";
export {
	loadUnifiedDiffPaths,
	parseUnifiedDiffPaths,
	partitionSeedCollateralLeaks,
	porcelainPathsFromLines,
	traceEditsOutsideWorktree,
} from "./worktree-leak.js";

export interface RunAgentInput extends Omit<RunAgentOptions, "context"> {
	context?: RunAgentOptions["context"];
	profile?: ContextProfile;
}

/** Run an agent session via the selected host adapter. */
export async function runAgent(input: RunAgentInput): Promise<AgentSession> {
	const context =
		input.context ?? (await loadContext({ cwd: input.cwd, profile: input.profile ?? "shared" }));
	const adapter = createAdapter(input.host);
	return adapter.run({ ...input, context });
}
