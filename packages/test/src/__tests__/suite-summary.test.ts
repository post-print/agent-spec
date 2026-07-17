import { describe, expect, it } from "vitest";

import { assertionFailure } from "../failures.js";
import { shouldFailScenario, summarizeFailures } from "../suite-summary.js";

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
});
