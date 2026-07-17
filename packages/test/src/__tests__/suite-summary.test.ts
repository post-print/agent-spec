import { describe, expect, it } from "vitest";

import { assertionFailure } from "../failures.js";
import {
	formatRunSummary,
	shouldFailScenario,
	summarizeFailures,
	summarizeReportResults,
} from "../suite-summary.js";

describe("suite-summary", () => {
	it("counts failure categories", () => {
		const summary = summarizeFailures([
			assertionFailure("mustInclude", "missing", "rubric_miss"),
			assertionFailure("judge:c1", "rate limit", "judge_infra"),
			assertionFailure("judge:c2", "bad json", "judge_parse"),
			assertionFailure("liveScenario", "oom", "agent_runtime"),
		]);
		expect(summary.rubricFailures).toBe(1);
		expect(summary.infraFailures).toBe(1);
		expect(summary.judgeParseFailures).toBe(1);
		expect(summary.agentRuntimeFailures).toBe(1);
		expect(summary.scenarioRetriedScenarios).toBe(0);
	});

	it("fail-on behavior ignores infra-only failures", () => {
		expect(
			shouldFailScenario([assertionFailure("judge:c1", "rate limit", "judge_infra")], "behavior"),
		).toBe(false);
		expect(
			shouldFailScenario([assertionFailure("mustInclude", "missing", "rubric_miss")], "behavior"),
		).toBe(true);
	});

	it("fail-on infra-only fails only on infra categories", () => {
		expect(
			shouldFailScenario([assertionFailure("judge:c1", "rate limit", "judge_infra")], "infra-only"),
		).toBe(true);
		expect(
			shouldFailScenario([assertionFailure("mustInclude", "missing", "rubric_miss")], "infra-only"),
		).toBe(false);
	});

	it("counts scenario retries separately from judge retries", () => {
		const summary = summarizeReportResults([
			{
				suite: "s",
				scenario: "a",
				passed: true,
				failures: [],
				durationMs: 1,
				attempts: 2,
			},
			{
				suite: "s",
				scenario: "b",
				passed: true,
				failures: [],
				durationMs: 1,
				judgeVerdicts: [
					{
						id: "j1",
						question: "q",
						pass: true,
						rationale: "ok",
						attempt: 2,
					},
				],
			},
		]);
		expect(summary.scenarioRetriedScenarios).toBe(1);
		expect(summary.retriedScenarios).toBe(1);
		expect(formatRunSummary(summary)).toContain("scenario_retried=1");
		expect(formatRunSummary(summary)).toContain("retried=1");
	});
});
