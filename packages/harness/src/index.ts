import { createAdapter } from "./adapters";
import { type LoadContextOptions, loadContext } from "./context";
import type { AgentSession, ContextProfile, RunAgentOptions } from "./types";

export type { SdkMessage } from "./capture";
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
} from "./types";

export { loadContext, type LoadContextOptions };
export {
	ClaudeAdapter,
	CursorAdapter,
	createAdapter,
	ReplayAdapter,
} from "./adapters";
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
} from "./capture";
export {
	assistantTextFromSdkMessages,
	type CursorRunOptions,
	type CursorRunResult,
	type JudgeClassifierOptions,
	type JudgeClassifierResult,
	runCursorAgent,
	runJudgeClassifier,
	textBlocksFromSdkMessage,
} from "./cursor-run";
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
} from "./judge";
export { buildRoutingContract } from "./routing-contract";
export { loadSkillContext, normalizeSkillContext, type SkillCatalogEntry } from "./skills-context";
export {
	captureWorkingTreeStatus,
	findWorkingTreeLeak,
	formatWorkingTreeLeak,
} from "./working-tree-guard";
export {
	cleanupStaleScenarioWorktrees,
	createScenarioWorktree,
	SCENARIO_WORKTREE_DIR_PREFIX,
	type ScenarioWorktree,
} from "./worktree";

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
