import { describe, expect, it } from "vitest";

import {
	liveScenarioIsolationEnabled,
	scenarioSettleMs,
	subprocessFailureMessage,
} from "../live-isolation.js";

describe("live-isolation", () => {
	it("enables isolation by default", () => {
		const priorChild = process.env.AGENT_TEST_CHILD;
		const priorNoIsolate = process.env.AGENT_TEST_NO_ISOLATE;
		process.env.AGENT_TEST_CHILD = undefined;
		process.env.AGENT_TEST_NO_ISOLATE = undefined;
		expect(liveScenarioIsolationEnabled()).toBe(true);
		process.env.AGENT_TEST_CHILD = priorChild;
		process.env.AGENT_TEST_NO_ISOLATE = priorNoIsolate;
	});

	it("disables isolation for child or AGENT_TEST_NO_ISOLATE", () => {
		process.env.AGENT_TEST_CHILD = "1";
		expect(liveScenarioIsolationEnabled()).toBe(false);
		process.env.AGENT_TEST_CHILD = undefined;
		process.env.AGENT_TEST_NO_ISOLATE = "1";
		expect(liveScenarioIsolationEnabled()).toBe(false);
		process.env.AGENT_TEST_NO_ISOLATE = undefined;
	});

	it("defaults settle ms to 5000", () => {
		const prior = process.env.AGENT_TEST_SCENARIO_SETTLE_MS;
		process.env.AGENT_TEST_SCENARIO_SETTLE_MS = undefined;
		expect(scenarioSettleMs()).toBe(5000);
		process.env.AGENT_TEST_SCENARIO_SETTLE_MS = prior;
	});

	it("maps exit 137 to OOM guidance", () => {
		expect(subprocessFailureMessage(137)).toContain("137");
		expect(subprocessFailureMessage(1)).toContain("exited 1");
	});
});
