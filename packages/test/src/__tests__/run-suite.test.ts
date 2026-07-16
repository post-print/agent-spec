import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverSuites } from "../discover-suites.js";
import {
	outputContractForRubric,
	runSuite,
	shouldPrintSuiteChrome,
} from "../run-suite.js";
import * as liveIsolation from "../live-isolation.js";
import * as recordTrace from "../record-trace.js";

describe("discoverSuites", () => {
	it("skips directories without scenarios.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-"));
		await mkdir(join(dir, "empty-suite"));
		await mkdir(join(dir, "real-suite"));
		await writeFile(
			join(dir, "real-suite", "scenarios.json"),
			JSON.stringify({
				name: "real-suite",
				scenarios: [{ name: "x", prompt: "p", rubric: {} }],
			}),
		);

		const paths = await discoverSuites(dir);
		expect(paths).toEqual([join(dir, "real-suite", "scenarios.json")]);
	});
});

describe("outputContractForRubric", () => {
	it("attaches hands-off for routingBlock rubrics", () => {
		expect(outputContractForRubric({ routingBlock: true })).toBe("hands-off");
	});

	it("attaches hands-on for handsOnRouting rubrics", () => {
		expect(outputContractForRubric({ handsOnRouting: true, tier: "low" })).toBe(
			"hands-on",
		);
	});

	it("prefers hands-off when both routing flags are set", () => {
		expect(
			outputContractForRubric({ routingBlock: true, handsOnRouting: true }),
		).toBe("hands-off");
	});

	it("returns undefined when no routing rubric flags are set", () => {
		expect(outputContractForRubric({ tier: "medium" })).toBeUndefined();
	});
});

describe("shouldPrintSuiteChrome", () => {
	const prior = process.env.AGENT_TEST_CHILD;

	afterEach(() => {
		if (prior === undefined) {
			delete process.env.AGENT_TEST_CHILD;
		} else {
			process.env.AGENT_TEST_CHILD = prior;
		}
	});

	it("prints suite headers and verdicts in the parent process", () => {
		delete process.env.AGENT_TEST_CHILD;
		expect(shouldPrintSuiteChrome()).toBe(true);
	});

	it("suppresses suite headers and verdicts in live child subprocesses", () => {
		process.env.AGENT_TEST_CHILD = "1";
		expect(shouldPrintSuiteChrome()).toBe(false);
	});
});

describe("runSuite isolateLive", () => {
	const priorChild = process.env.AGENT_TEST_CHILD;
	const priorNoIsolate = process.env.AGENT_TEST_NO_ISOLATE;

	afterEach(() => {
		vi.restoreAllMocks();
		if (priorChild === undefined) {
			delete process.env.AGENT_TEST_CHILD;
		} else {
			process.env.AGENT_TEST_CHILD = priorChild;
		}
		if (priorNoIsolate === undefined) {
			delete process.env.AGENT_TEST_NO_ISOLATE;
		} else {
			process.env.AGENT_TEST_NO_ISOLATE = priorNoIsolate;
		}
	});

	it("skips spawn and judge for skipped scenarios under isolation", async () => {
		delete process.env.AGENT_TEST_CHILD;
		delete process.env.AGENT_TEST_NO_ISOLATE;

		const dir = await mkdtemp(join(tmpdir(), "agent-test-isolate-"));
		const suitePath = join(dir, "scenarios.json");
		await writeFile(
			suitePath,
			JSON.stringify({
				name: "isolate-skip",
				defaults: { host: "cursor" },
				scenarios: [
					{ name: "active", prompt: "p", rubric: {} },
					{
						name: "skipped-live",
						prompt: "p",
						rubric: { judge: ["did it work?"] },
						skip: true,
					},
				],
			}),
		);

		const spawnSpy = vi
			.spyOn(liveIsolation, "spawnLiveScenario")
			.mockResolvedValue(0);

		const report = await runSuite({
			cwd: dir,
			suitePath,
			stagingSessionId: "sess-skip",
			judge: true,
		});

		expect(spawnSpy).toHaveBeenCalledTimes(1);
		expect(spawnSpy.mock.calls[0]?.[0].scenarioName).toBe("active");
		const skipped = report.results.find((r) => r.scenario === "skipped-live");
		expect(skipped).toMatchObject({
			passed: true,
			skipped: true,
			failures: [],
		});
	});

	it("merges child rubric failures from staging sidecar on subprocess failure", async () => {
		delete process.env.AGENT_TEST_CHILD;
		delete process.env.AGENT_TEST_NO_ISOLATE;

		const dir = await mkdtemp(join(tmpdir(), "agent-test-sidecar-"));
		const suitePath = join(dir, "scenarios.json");
		await writeFile(
			suitePath,
			JSON.stringify({
				name: "isolate-sidecar",
				defaults: { host: "cursor" },
				scenarios: [
					{ name: "first", prompt: "p", rubric: {} },
					{ name: "failing", prompt: "p", rubric: {} },
				],
			}),
		);

		vi.spyOn(liveIsolation, "spawnLiveScenario").mockImplementation(
			async (options) => (options.scenarioName === "failing" ? 1 : 0),
		);
		vi.spyOn(recordTrace, "loadStagingResult").mockImplementation(
			async (_path) => {
				if (_path.includes("failing")) {
					return {
						passed: false,
						durationMs: 12,
						failures: [
							{
								matcher: "toHaveReviewDepth",
								message: 'expected review depth "thorough"',
							},
						],
					};
				}
				return undefined;
			},
		);

		const report = await runSuite({
			cwd: dir,
			suitePath,
			stagingSessionId: "sess-sidecar",
			judge: false,
		});

		const failed = report.results.find((r) => r.scenario === "failing");
		expect(failed?.passed).toBe(false);
		expect(failed?.failures).toEqual([
			{
				matcher: "toHaveReviewDepth",
				message: 'expected review depth "thorough"',
			},
		]);
	});
});
