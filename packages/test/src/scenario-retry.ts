import type { AgentTrace } from "@post-print/agent-harness";

import type { AssertionFailure } from "./types.js";

/** Matchers that fire when the agent stops after Routing without starting the review. */
export const ANNOUNCE_STOP_MATCHERS = new Set([
	"toHaveInvokedSkill",
	"toHaveReviewDepth",
	"toHaveHandsOnTier",
	"toHaveHandsOnTierBeforeTools",
	"toHaveRoutingBlockBeforeTools",
	"toHaveTier",
]);

const DEFAULT_SCENARIO_RETRIES = 1;

/**
 * Total attempts for a live scenario (initial run + retries).
 * `AGENT_TEST_SCENARIO_RETRIES` / explicit value is the retry count (default 1 → 2 attempts; 0 disables).
 */
export function resolveScenarioRetryMaxAttempts(
	explicit?: number,
	envKey = "AGENT_TEST_SCENARIO_RETRIES",
): number {
	const retries = explicit ?? parseScenarioRetriesEnv(envKey);
	if (!Number.isInteger(retries) || retries < 0) {
		return DEFAULT_SCENARIO_RETRIES + 1;
	}
	return retries + 1;
}

function parseScenarioRetriesEnv(envKey: string): number {
	const raw = process.env[envKey]?.trim();
	if (!raw) {
		return DEFAULT_SCENARIO_RETRIES;
	}
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return DEFAULT_SCENARIO_RETRIES;
	}
	return parsed;
}

/**
 * True when failures look like announce-stop (routing-only exit) rather than a real skill miss.
 * Wrong depth/skill with tools used must not retry.
 */
export function shouldRetryAnnounceStopFlake(
	failures: AssertionFailure[],
	trace: AgentTrace | undefined,
): boolean {
	if (failures.length === 0) {
		return false;
	}
	if (failures.some((failure) => failure.category !== "rubric_miss")) {
		return false;
	}
	if (failures.some((failure) => !ANNOUNCE_STOP_MATCHERS.has(failure.matcher))) {
		return false;
	}
	if (trace !== undefined && trace.toolCalls.length > 0) {
		return false;
	}
	return true;
}
