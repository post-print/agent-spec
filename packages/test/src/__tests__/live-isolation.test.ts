import { afterEach, describe, expect, it } from "vitest";

import {
	buildLiveScenarioCommand,
	failuresForLiveSubprocessExit,
	killActiveLiveChildren,
	liveScenarioIsolationEnabled,
	parentScenarioCounters,
	scenarioSettleMs,
	subprocessFailureMessage,
	subprocessKillDelayMs,
} from "../live-isolation.js";
import { setLiveStagingRootOverride } from "../record-trace.js";

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

	it("defaults settle ms to 5000 after failure and 500 after success", () => {
		const prior = process.env.AGENT_TEST_SCENARIO_SETTLE_MS;
		delete process.env.AGENT_TEST_SCENARIO_SETTLE_MS;
		expect(scenarioSettleMs()).toBe(5000);
		expect(scenarioSettleMs(0)).toBe(500);
		expect(scenarioSettleMs(1)).toBe(5000);
		if (prior === undefined) {
			delete process.env.AGENT_TEST_SCENARIO_SETTLE_MS;
		} else {
			process.env.AGENT_TEST_SCENARIO_SETTLE_MS = prior;
		}
	});

	it("maps exit 137 to OOM guidance", () => {
		expect(subprocessFailureMessage(137)).toContain("137");
		expect(subprocessFailureMessage(124)).toContain("timed out");
		expect(subprocessFailureMessage(1)).toContain("exited 1");
	});

	it("forwards --debug and --debug-dir to the child CLI", () => {
		const { args } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "routing",
			scenarioName: "medium: grill",
			suitesDir: "agent-suites",
			debug: true,
			debugDir: "/tmp/agent-debug",
		});
		expect(args).toContain("--debug");
		expect(args).toContain("--debug-dir");
		expect(args).toContain("/tmp/agent-debug");
	});

	it("forwards process-global staging override as --debug-dir when unset", () => {
		setLiveStagingRootOverride("/tmp/override-root");
		const { args } = buildLiveScenarioCommand({
			cwd: "/repo",
			suiteName: "routing",
			scenarioName: "medium: grill",
			suitesDir: "agent-suites",
		});
		expect(args).toContain("--debug-dir");
		expect(args).toContain("/tmp/override-root");
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

	it("arms parent kill from agent-start marker plus harness deadline", () => {
		const agentStart = Date.now() - 5_000;
		const delay = subprocessKillDelayMs(agentStart, 60_000);
		expect(delay).toBeGreaterThan(54_000);
		expect(delay).toBeLessThanOrEqual(60_000 + 30_000);
	});

	it("honors a persisted pass sidecar over late timeout exit 124", () => {
		expect(
			failuresForLiveSubprocessExit(124, {
				passed: true,
				failures: [],
			}),
		).toEqual([]);
	});

	it("does not let a pass sidecar mask non-timeout exits", () => {
		for (const exitCode of [1, 137]) {
			expect(
				failuresForLiveSubprocessExit(exitCode, {
					passed: true,
					failures: [],
				}),
			).toEqual([
				{
					matcher: "liveScenario",
					message: subprocessFailureMessage(exitCode),
					category: "agent_runtime",
				},
			]);
		}
	});

	it("keeps rubric failures when the sidecar already failed", () => {
		expect(
			failuresForLiveSubprocessExit(124, {
				passed: false,
				failures: [{ matcher: "toContain", message: "missing", category: "rubric_miss" }],
			}),
		).toEqual([{ matcher: "toContain", message: "missing", category: "rubric_miss" }]);
	});

	it("synthesizes timeout failure when sidecar is missing", () => {
		expect(failuresForLiveSubprocessExit(124, undefined)).toEqual([
			{
				matcher: "liveScenario",
				message: subprocessFailureMessage(124),
				category: "agent_runtime",
			},
		]);
	});

	it("killActiveLiveChildren is safe when no children are tracked", () => {
		expect(() => killActiveLiveChildren()).not.toThrow();
	});
});

afterEach(() => {
	setLiveStagingRootOverride(undefined);
});
