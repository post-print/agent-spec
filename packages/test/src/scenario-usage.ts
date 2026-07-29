import {
	type AgentUsage,
	buildScenarioUsageBreakdown,
	type ScenarioUsageBreakdown,
	sumUsageParts,
} from "@post-print/agent-harness";

import type { JudgeVerdictResult } from "./types.js";

export function judgeUsageFromVerdicts(verdicts?: JudgeVerdictResult[]): AgentUsage | undefined {
	return sumUsageParts((verdicts ?? []).map((v) => v.usage));
}

export function buildScenarioResultUsage(options: {
	agentUsage?: AgentUsage;
	judgeVerdicts?: JudgeVerdictResult[];
	judgeUsage?: AgentUsage;
}): {
	usage?: ScenarioUsageBreakdown;
	agentUsage?: AgentUsage;
	judgeUsage?: AgentUsage;
} {
	const agentUsage = options.agentUsage;
	const judgeUsage = options.judgeUsage ?? judgeUsageFromVerdicts(options.judgeVerdicts);
	const usage = buildScenarioUsageBreakdown(agentUsage, judgeUsage);
	if (!usage) {
		return {};
	}
	return { usage, agentUsage, judgeUsage };
}

/** Flat total tokens for summaries and terminal output. */
export function totalTokensFromScenarioUsage(
	usage?: ScenarioUsageBreakdown,
	fallback?: AgentUsage,
): number | undefined {
	const total = usage?.total?.totalTokens ?? fallback?.totalTokens;
	return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}
