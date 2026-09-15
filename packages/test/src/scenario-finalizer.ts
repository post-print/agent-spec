import type { AgentTrace, AgentUsage, ContextMode } from "@post-print/agent-harness";

import { plainDescription } from "./compare-scenario.js";
import { buildScenarioStory, type StoryCompareInput } from "./scenario-story.js";
import { buildScenarioResultUsage } from "./scenario-usage.js";
import type {
	AssertionFailure,
	JudgeVerdictResult,
	ScenarioCompareResult,
	ScenarioContextFile,
	ScenarioResult,
	ScenarioRubric,
} from "./types.js";

export interface FinalizeScenarioResultInput {
	suite: string;
	scenario: {
		name: string;
		description?: string;
		prompt: string;
		rubric: ScenarioRubric;
	};
	failures: AssertionFailure[];
	durationMs: number;
	trace?: AgentTrace;
	judgeVerdicts?: JudgeVerdictResult[];
	compare?: ScenarioCompareResult;
	storyCompare?: StoryCompareInput;
	agentUsage?: AgentUsage;
	attempts?: number;
	skipped?: boolean;
	contextMode?: ContextMode;
	contextFiles?: ScenarioContextFile[];
	hostInput?: string;
}

/** The single domain boundary that turns execution evidence into the authoritative result. */
export function finalizeScenarioResult(input: FinalizeScenarioResultInput): ScenarioResult {
	const passed = input.failures.length === 0;
	const story = buildScenarioStory({
		rubric: input.scenario.rubric,
		trace: input.trace,
		passed,
		failures: input.failures,
		judgeVerdicts: input.judgeVerdicts,
		compare: input.storyCompare,
		skipped: input.skipped,
	});
	return {
		suite: input.suite,
		scenario: input.scenario.name,
		description: plainDescription(input.scenario.description),
		prompt: input.scenario.prompt,
		contextMode: input.contextMode,
		contextFiles: input.contextFiles,
		hostInput: input.hostInput,
		passed,
		skipped: input.skipped,
		failures: input.failures,
		durationMs: input.durationMs,
		judgeVerdicts: input.judgeVerdicts,
		trace: input.trace,
		compare: input.compare,
		story,
		...(input.attempts === undefined ? {} : { attempts: input.attempts }),
		...buildScenarioResultUsage({
			agentUsage: input.agentUsage ?? input.trace?.usage,
			judgeVerdicts: input.judgeVerdicts,
		}),
	};
}
