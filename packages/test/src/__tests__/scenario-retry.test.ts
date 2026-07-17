import type { AgentTrace } from "@post-print/agent-harness";
import { afterEach, describe, expect, it } from "vitest";

import { assertionFailure } from "../failures.js";
import {
	resolveScenarioRetryMaxAttempts,
	shouldRetryAnnounceStopFlake,
} from "../scenario-retry.js";

function emptyTrace(overrides?: Partial<AgentTrace>): AgentTrace {
	return {
		messages: [],
		toolCalls: [],
		...overrides,
	};
}

describe("resolveScenarioRetryMaxAttempts", () => {
	const prior = process.env.AGENT_TEST_SCENARIO_RETRIES;

	afterEach(() => {
		if (prior === undefined) {
			delete process.env.AGENT_TEST_SCENARIO_RETRIES;
		} else {
			process.env.AGENT_TEST_SCENARIO_RETRIES = prior;
		}
	});

	it("defaults to 2 total attempts (1 retry)", () => {
		delete process.env.AGENT_TEST_SCENARIO_RETRIES;
		expect(resolveScenarioRetryMaxAttempts()).toBe(2);
	});

	it("treats 0 as a single attempt (retries disabled)", () => {
		expect(resolveScenarioRetryMaxAttempts(0)).toBe(1);
	});

	it("honors explicit retry count", () => {
		expect(resolveScenarioRetryMaxAttempts(2)).toBe(3);
	});

	it("reads AGENT_TEST_SCENARIO_RETRIES", () => {
		process.env.AGENT_TEST_SCENARIO_RETRIES = "0";
		expect(resolveScenarioRetryMaxAttempts()).toBe(1);
		process.env.AGENT_TEST_SCENARIO_RETRIES = "3";
		expect(resolveScenarioRetryMaxAttempts()).toBe(4);
	});

	it("falls back to default for non-integer env", () => {
		process.env.AGENT_TEST_SCENARIO_RETRIES = "nope";
		expect(resolveScenarioRetryMaxAttempts()).toBe(2);
	});
});

describe("shouldRetryAnnounceStopFlake", () => {
	it("retries announce-stop skill/depth misses with no tools", () => {
		expect(
			shouldRetryAnnounceStopFlake(
				[
					assertionFailure("toHaveInvokedSkill", "missing skill", "rubric_miss"),
					assertionFailure("toHaveReviewDepth", "missing depth", "rubric_miss"),
				],
				emptyTrace(),
			),
		).toBe(true);
	});

	it("retries when trace is missing", () => {
		expect(
			shouldRetryAnnounceStopFlake(
				[assertionFailure("toHaveInvokedSkill", "missing", "rubric_miss")],
				undefined,
			),
		).toBe(true);
	});

	it("does not retry when tools were used", () => {
		expect(
			shouldRetryAnnounceStopFlake(
				[assertionFailure("toHaveReviewDepth", "wrong depth", "rubric_miss")],
				emptyTrace({ toolCalls: [{ name: "Shell", input: {} }] }),
			),
		).toBe(false);
	});

	it("does not retry agent_runtime failures", () => {
		expect(
			shouldRetryAnnounceStopFlake(
				[assertionFailure("liveScenario", "oom", "agent_runtime")],
				emptyTrace(),
			),
		).toBe(false);
	});

	it("does not retry non-announce-stop matchers", () => {
		expect(
			shouldRetryAnnounceStopFlake(
				[assertionFailure("toContain", "missing", "rubric_miss")],
				emptyTrace(),
			),
		).toBe(false);
	});

	it("does not retry empty failures", () => {
		expect(shouldRetryAnnounceStopFlake([], emptyTrace())).toBe(false);
	});
});
