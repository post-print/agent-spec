import { mergeAgentUsage } from "./capture.js";
import type { AgentUsage } from "./types.js";

/** Agent + judge + total token usage for one scenario. */
export interface ScenarioUsageBreakdown {
	agent?: AgentUsage;
	judge?: AgentUsage;
	total?: AgentUsage;
}

/** Field-wise sum of agent and judge usage snapshots. */
export function buildScenarioUsageBreakdown(
	agent?: AgentUsage,
	judge?: AgentUsage,
): ScenarioUsageBreakdown | undefined {
	const total = mergeAgentUsage(agent, judge);
	if (!agent && !judge && !total) {
		return undefined;
	}
	return { agent, judge, total };
}

/** Sum usage from an array of partial snapshots (e.g. judge criteria). */
export function sumUsageParts(parts: Array<AgentUsage | undefined>): AgentUsage | undefined {
	let merged: AgentUsage | undefined;
	for (const part of parts) {
		merged = mergeAgentUsage(merged, part);
	}
	return merged;
}
