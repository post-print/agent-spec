import { describe, expect, it } from "vitest";

import {
	buildLiveScenarioCommand,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
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
		expect(subprocessFailureMessage(124)).toContain("timed out");
		expect(subprocessFailureMessage(1)).toContain("exited 1");
	});

	it("builds a Node subprocess command, not bun", () => {
		const { command, args, execArgv } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "smoke",
			scenarioName: "hello",
			suitesDir: "agent-suites",
		});
		expect(command).toBe(process.execPath);
		expect(command).not.toBe("bun");
		expect(args[0]).toBe(process.argv[1]);
		expect(args).toContain("--live");
		expect(args).toContain("--scenario");
		expect(args).toContain("hello");
		expect(args).toContain("--no-judge");
		expect(execArgv).toContain("--disable-warning=ExperimentalWarning");
	});

	it("forwards timeout-ms to the child CLI", () => {
		const { args } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "routing",
			scenarioName: "medium: crystallize fuzzy idea",
			suitesDir: "agent-suites",
			timeoutMs: 120_000,
		});
		expect(args).toContain("--timeout-ms");
		expect(args).toContain("120000");
	});

	it("forwards --no-timeout to the child CLI", () => {
		const { args } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "routing",
			scenarioName: "long-run",
			suitesDir: "agent-suites",
			noTimeout: true,
		});
		expect(args).toContain("--no-timeout");
		expect(args).not.toContain("--timeout-ms");
	});

	it("forwards allow-user-input to the child CLI", () => {
		const { args } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "routing",
			scenarioName: "dialogue",
			suitesDir: "agent-suites",
			allowUserInput: true,
		});
		expect(args).toContain("--allow-user-input");
	});

	it("reads parent scenario counters from env", () => {
		const priorIndex = process.env.AGENT_TEST_SCENARIO_INDEX;
		const priorTotal = process.env.AGENT_TEST_SCENARIO_TOTAL;
		process.env.AGENT_TEST_SCENARIO_INDEX = "2";
		process.env.AGENT_TEST_SCENARIO_TOTAL = "4";
		expect(parentScenarioCounters()).toEqual({ index: 2, total: 4 });
		delete process.env.AGENT_TEST_SCENARIO_INDEX;
		delete process.env.AGENT_TEST_SCENARIO_TOTAL;
		expect(parentScenarioCounters()).toBeUndefined();
		if (priorIndex !== undefined) {
			process.env.AGENT_TEST_SCENARIO_INDEX = priorIndex;
		}
		if (priorTotal !== undefined) {
			process.env.AGENT_TEST_SCENARIO_TOTAL = priorTotal;
		}
	});
});
