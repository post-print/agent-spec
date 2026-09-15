import { createAdapter } from "./adapters/index.js";
import { loadContext } from "./context.js";
import { runConversation, type UserSimulator } from "./conversation.js";
import type { AgentSession, ContextProfile, RunAgentOptions } from "./types.js";
import { createJudgeUserSimulator } from "./user-simulator.js";

export {
	buildHostPrompt,
	ClaudeAdapter,
	CursorAdapter,
	createAdapter,
	OpenaiAdapter,
} from "./adapters/index.js";
export {
	DEFAULT_HOST_AUTH_MODE,
	getProcessAuthMode,
	HOST_AUTH_MODES,
	type HostAuthMode,
	parseHostAuthModeFlag,
	parseOptionalAuthMode,
	resolveHostAuthMode,
	resolveKeyOrLoginAuthMode,
	setProcessAuthMode,
} from "./auth-mode.js";
export type { SdkMessage } from "./capture.js";
export {
	assistantPrefixBeforeTools,
	buildTraceFromSdkMessages,
	captureGitDiff,
	collapseTraceWhitespace,
	enrichTrace,
	extractShellCommands,
	extractShellCommandsFromToolCalls,
	extractSkillsInvokedFromText,
	extractSkillsInvokedFromToolCalls,
	handsOnTierBeforeTools,
	inferReviewDepthFromText,
	inferRoutingFromText,
	mergeAgentUsage,
	mergeSkillsInvoked,
	normalizeAgentUsage,
	resolvedTotalTokens,
	routingBlockBeforeTools,
} from "./capture.js";
export {
	type ClassifierOptions,
	missingClassifierAuth,
	runClassifier,
} from "./classifier.js";
export {
	accumulateClaudeEvent,
	buildTraceFromClaudeEvents,
	type ClaudeContentBlock,
	type ClaudeStreamEvent,
	type ClaudeTraceAccumulator,
	createClaudeTraceAccumulator,
	finalizeClaudeTraceAccumulator,
	normalizeClaudeToolArgs,
	normalizeClaudeUsage,
	parseClaudeNdjsonLine,
} from "./claude-capture.js";
export {
	buildClaudeEnv,
	buildClaudeMcpConfigJson,
	CLAUDE_AUTH_MODE_ENV,
	type ClaudeAuthMode,
	type ClaudeRunOptions,
	type ClaudeRunResult,
	cancelActiveClaudeRun,
	formatClaudeRunFailure,
	parseClaudeAuthMode,
	resolveClaudeAuthMode,
	resolveClaudeBin,
	runClaudeAgent,
	runClaudeClassifier,
	takeLastClaudeRunTrace,
	withMcpAllowedTools,
} from "./claude-run.js";
export {
	type LoadContextOptions,
	loadContext,
	parseSkeletonAlwaysInclude,
	summarizeSkeletonConfig,
} from "./context.js";
export {
	composeFollowUpPrompt,
	extractUserQuestions,
	mergeConversationTraces,
	type RunConversationOptions,
	runConversation,
	type UserQuestion,
	type UserSimulator,
} from "./conversation.js";
export {
	CURSOR_SDK_AUTH_REL,
	CURSOR_SDK_AUTH_TOO_OLD,
	CURSOR_SDK_LOGIN_HINT,
	type CursorSdkAuthClient,
	type CursorSdkAuthStatus,
	type CursorSdkLoginPublicResult,
	cursorSdkAuthFilePath,
	hasCursorSdkAuthFile,
	isInvalidCursorUserApiKey,
	loginCursorSdk,
	readCursorSdkAuthStatus,
	wrapCursorSdkAuthError,
} from "./cursor-auth.js";
export {
	assistantTextFromSdkMessages,
	CURSOR_AUTH_MODE_ENV,
	CURSOR_MISSING_KEY_MESSAGE,
	type CursorAuthMode,
	type CursorRunOptions,
	type CursorRunResult,
	cancelActiveCursorRun,
	formatCursorRunFailure,
	type JudgeClassifierOptions,
	type JudgeClassifierResult,
	type JudgeSdkError,
	resolveCursorAuthMode,
	runCursorAgent,
	runJudgeClassifier,
	takeLastCursorRunTrace,
	textBlocksFromSdkMessage,
	withCursorAuthEnv,
} from "./cursor-run.js";
export {
	clearRegisteredHostAdapters,
	getRegisteredAdapter,
	isKnownAgentHost,
	knownAgentHosts,
	listRegisteredHosts,
	registerHostAdapter,
	unregisterHostAdapter,
} from "./host-registry.js";
export {
	buildCompareJudgePrompt,
	buildMultiArmCompareJudgePrompt,
	type CompareJudgeArm,
	type CompareJudgeInput,
	type CompareJudgePair,
	formatTraceForJudge,
	type JudgeCriterion,
	type JudgeTraceOptions,
	type JudgeTraceResult,
	type JudgeVerdict,
	judgeCompareTraces,
	judgeTrace,
	type ParsedJudgeJson,
	parseJudgeJsonResponse,
	parseJudgeLegacyResponse,
	parseJudgeResponse,
	skillInvokeJudgeCriteria,
} from "./judge.js";
export {
	createLiveNotifyState,
	drainLiveAgentEvents,
	emitLiveAgentEvents,
	type LiveNotifyState,
} from "./live-agent-event.js";
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
	buildOpenaiEnv,
	buildOpenaiExecArgs,
	buildOpenaiMcpConfigArgs,
	buildOpenaiMcpOverride,
	cancelActiveOpenaiRun,
	formatOpenaiRunFailure,
	OPENAI_AUTH_MODE_ENV,
	OPENAI_MISSING_KEY_MESSAGE,
	type OpenaiAuthMode,
	type OpenaiRunOptions,
	type OpenaiRunResult,
	resolveOpenaiAuthMode,
	resolveOpenaiBin,
	runOpenaiAgent,
	runOpenaiClassifier,
	takeLastOpenaiRunTrace,
} from "./openai-run.js";
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
	createSealedWorkspace,
	defaultSealedOverlayPaths,
	isCallerHeadWorkspace,
	type ParsedScenarioWorkspace,
	parseScenarioWorkspace,
	SEALED_WORKSPACE_DIR_PREFIX,
	type SealedWorkspace,
	toolPathsOutsideWorkspace,
} from "./sealed-workspace.js";
export {
	isRepoRelativeSkillPath,
	loadSkillContext,
	normalizeRelSkillPath,
	normalizeSkillContext,
	SKILL_ROOTS,
	type SkillCatalogEntry,
	skillManifestRelPath,
	skillNameFromWorkflowPath,
	skillOverlayRelPath,
	skillPathsFromSetting,
} from "./skills-context.js";
export {
	AGENT_HOSTS,
	type AgentHost,
	type AgentMessage,
	type AgentSession,
	type AgentToolCall,
	type AgentTrace,
	type AgentUsage,
	type BuiltinAgentHost,
	type ContextMode,
	type ContextProfile,
	type HostAdapter,
	isAgentHost,
	isBuiltinAgentHost,
	isHostSlug,
	type LiveAgentEvent,
	type LoadedContext,
	type McpServerConfig,
	type RoutingContract,
	type RunAgentOptions,
	type RunStatus,
	type SkillContextMode,
	type SkillContextOptions,
	type SkillContextSetting,
} from "./types.js";
export {
	buildScenarioUsageBreakdown,
	type ScenarioUsageBreakdown,
	sumUsageParts,
} from "./usage-breakdown.js";
export {
	createJudgeUserSimulator,
	type JudgeUserSimulatorOptions,
} from "./user-simulator.js";
export {
	CURSOR_USER_HOME_DIR_PREFIX,
	CURSOR_USER_SKILL_ROOTS,
	type CursorSettingSource,
	type CursorUserHome,
	claudeSessionFlags,
	countUserSkillEntries,
	createCursorUserHome,
	cursorSettingSources,
	cursorUserSkillRoots,
	openaiUserConfigArgs,
	resolveAllowUserSkills,
	withCursorUserHome,
} from "./user-skills.js";
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
	/** Injected user agent for conversation turns. Default is a judge-backed user. */
	userSimulator?: UserSimulator;
}

/** Run an agent session via the selected host adapter. */
export async function runAgent(input: RunAgentInput): Promise<AgentSession> {
	const context =
		input.context ?? (await loadContext({ cwd: input.cwd, profile: input.profile ?? "shared" }));
	const adapter = createAdapter(input.host);
	const runOptions = { ...input, context };
	if (input.failOnUserInput !== false) {
		return adapter.run(runOptions);
	}
	return runConversation({
		initialPrompt: input.prompt,
		maxTurns: input.maxConversationTurns,
		userSimulator:
			input.userSimulator ?? createJudgeUserSimulator({ cwd: input.cwd, host: input.host }),
		runTurn: (prompt) => adapter.run({ ...runOptions, prompt, failOnUserInput: false }),
	});
}
