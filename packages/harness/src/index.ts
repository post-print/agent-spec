import { createAdapter } from "./adapters/index.js";
import { type LoadContextOptions, loadContext } from "./context.js";
import type { AgentSession, ContextProfile, RunAgentOptions } from "./types.js";

export type { SdkMessage } from "./capture.js";
export type {
	AgentHost,
	AgentMessage,
	AgentSession,
	AgentToolCall,
	AgentTrace,
	ContextProfile,
	HostAdapter,
	LoadedContext,
	RoutingContract,
	RunAgentOptions,
	RunStatus,
	SkillContextMode,
	SkillContextOptions,
	SkillContextSetting,
} from "./types.js";

export { loadContext, type LoadContextOptions };
export {
	ClaudeAdapter,
	CursorAdapter,
	createAdapter,
	ReplayAdapter,
} from "./adapters/index.js";
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
	mergeSkillsInvoked,
	routingBlockBeforeTools,
} from "./capture.js";
export {
	assistantTextFromSdkMessages,
	type CursorRunOptions,
	type CursorRunResult,
	type JudgeClassifierOptions,
	type JudgeClassifierResult,
	runCursorAgent,
	runJudgeClassifier,
	textBlocksFromSdkMessage,
} from "./cursor-run.js";
export {
	AgentRunTimeoutError,
	isUserInputTool,
	traceHasUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
	type RunTimeoutOptions,
} from "./run-guards.js";
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
export { buildRoutingContract } from "./routing-contract.js";
export { loadSkillContext, normalizeSkillContext, type SkillCatalogEntry } from "./skills-context.js";
export {
	captureWorkingTreeStatus,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
} from "./working-tree-guard.js";
export {
	cleanupStaleScenarioWorktrees,
	createScenarioWorktree,
	SCENARIO_WORKTREE_DIR_PREFIX,
	type ScenarioWorktree,
} from "./worktree.js";

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
