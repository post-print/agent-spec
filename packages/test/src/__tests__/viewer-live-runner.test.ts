import { describe, expect, it } from "bun:test";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	cleanupStagingSession,
	getLiveStagingSessionRoot,
	getStagingResultPath,
	writeStagingResult,
} from "../record-trace.js";
import type { ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import { createLiveViewerRunner } from "../viewer/live-runner.js";

const job: ViewerJob = {
	suite: "smoke",
	scenario: "hello",
	host: "cursor",
	prompt: "Say smoke ok.",
};

describe("live viewer runner", () => {
	it("emits cell_started before the isolated child starts", async () => {
		const order: string[] = [];
		const runner = createLiveViewerRunner({
			cwd: "/tmp",
			suitesDir: "agent-suites",
			missingAuth: () => undefined,
			spawnLiveScenario: async (options) => {
				order.push("spawn");
				expect(options.cliPath).toBe("/repo/dist/cli.js");
				return { exitCode: 0, stderr: "" };
			},
			cliPath: "/repo/dist/cli.js",
		});
		await runner.runJob(
			job,
			(event: ViewerEvent) => {
				order.push(event.type);
			},
			new AbortController().signal,
		);
		expect(order[0]).toBe("cell_started");
		expect(order).toContain("status");
		expect(order).toContain("spawn");
		expect(order.indexOf("cell_started")).toBeLessThan(order.indexOf("spawn"));
	});

	it("emits the child stderr when the isolated process fails", async () => {
		const events: ViewerEvent[] = [];
		const runner = createLiveViewerRunner({
			cwd: "/tmp",
			suitesDir: "agent-suites",
			missingAuth: () => undefined,
			spawnLiveScenario: async () => ({
				exitCode: 1,
				stderr: "Command failed: git init -b main\nOperation not permitted",
			}),
		});
		await runner.runJob(job, (event) => events.push(event), new AbortController().signal);
		expect(events.some((event) => event.type === "status")).toBe(true);
		expect(
			events.some((event) => event.type === "error" && event.message.includes("git init")),
		).toBe(true);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "cell_finished", passed: false }),
		);
		expect(events.at(-1)).toMatchObject({ type: "scenario_result", result: { passed: false } });
	});

	it("does not emit a failure when the run is aborted", async () => {
		const abort = new AbortController();
		const events: ViewerEvent[] = [];
		const runner = createLiveViewerRunner({
			cwd: "/tmp",
			suitesDir: "agent-suites",
			missingAuth: () => undefined,
			spawnLiveScenario: async () => {
				abort.abort();
				return { exitCode: 143, stderr: "" };
			},
		});
		await runner.runJob(job, (event) => events.push(event), abort.signal);
		expect(events.some((event) => event.type === "error")).toBe(false);
		expect(events.some((event) => event.type === "cell_finished")).toBe(false);
	});

	it("attaches an arm judge snapshot from the child sidecar without exposing its path", async () => {
		const events: ViewerEvent[] = [];
		let sessionId = "";
		const runner = createLiveViewerRunner({
			cwd: "/tmp",
			suitesDir: "agent-suites",
			missingAuth: () => undefined,
			spawnLiveScenario: async (options) => {
				sessionId = options.stagingSessionId ?? "";
				options.onViewerEvent?.({
					type: "scenario_result",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					arm: "a",
					result: {
						suite: job.suite,
						scenario: job.scenario,
						passed: true,
						failures: [],
						durationMs: 1,
					},
				});
				await writeStagingResult(getStagingResultPath(sessionId, job.suite, job.scenario, "a"), {
					passed: true,
					failures: [],
					durationMs: 1,
					judgeWorkspace: { name: "a", path: "/tmp/readonly-a" },
				});
				return { exitCode: 0, stderr: "" };
			},
		});
		await runner.runJob(
			{ ...job, arm: "a" },
			(event) => events.push(event),
			new AbortController().signal,
		);

		const result = events.find((event) => event.type === "scenario_result");
		expect(result?.type).toBe("scenario_result");
		if (result?.type === "scenario_result") {
			expect(result.result.judgeWorkspace).toEqual({ name: "a", path: "/tmp/readonly-a" });
			expect(JSON.stringify(result)).not.toContain("readonly-a");
		}
		await cleanupStagingSession(getLiveStagingSessionRoot(sessionId));
	});

	it("finalizes scheduled compare arms through the shared runner boundary", async () => {
		const runner = createLiveViewerRunner({ cwd: "/tmp", suitesDir: "agent-suites", judge: false });
		const makeResult = (tokens: number) => ({
			suite: "smoke",
			scenario: "pair",
			passed: true,
			failures: [],
			durationMs: tokens,
			trace: {
				messages: [{ role: "assistant" as const, content: "ok" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
				usage: { totalTokens: tokens },
			},
		});
		const result = await runner.finalizeCompare?.({
			suite: "smoke",
			host: "cursor",
			scenario: {
				name: "pair",
				prompt: "Compare.",
				rubric: {},
				compare: [
					{ id: "a", label: "control", prompt: "Control.", rubric: {} },
					{ id: "b", label: "candidate", prompt: "Candidate.", rubric: {} },
				],
				gates: [{ metric: "tokens", winner: "b", loser: "a" }],
			},
			armResults: new Map([
				["a", makeResult(20)],
				["b", makeResult(10)],
			]),
		});

		expect(result?.passed).toBe(true);
		expect(result?.compare?.gateResults?.[0]).toMatchObject({ passed: true, left: 10, right: 20 });
	});

	it("rehydrates serialized arm judge workspaces before comparison cleanup", async () => {
		const runner = createLiveViewerRunner({ cwd: "/tmp", suitesDir: "agent-suites", judge: false });
		const workspaceA = await mkdtemp(join(tmpdir(), "agent-test-viewer-a-"));
		const workspaceB = await mkdtemp(join(tmpdir(), "agent-test-viewer-b-"));
		const makeResult = (tokens: number, workspace?: { name: string; path: string }) => {
			const result = {
				suite: "smoke",
				scenario: "pair",
				passed: true,
				failures: [],
				durationMs: tokens,
				trace: {
					messages: [{ role: "assistant" as const, content: "ok" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
					usage: { totalTokens: tokens },
				},
			};
			if (workspace) Object.defineProperty(result, "judgeWorkspace", { value: workspace });
			return result;
		};
		const result = await runner.finalizeCompare?.({
			suite: "smoke",
			host: "cursor",
			scenario: {
				name: "pair",
				prompt: "Compare.",
				rubric: {},
				compare: [
					{ id: "a", label: "control", prompt: "Control.", rubric: {} },
					{ id: "b", label: "candidate", prompt: "Candidate.", rubric: {} },
				],
				gates: [{ metric: "tokens", winner: "b", loser: "a" }],
			},
			armResults: new Map([
				["a", makeResult(20, { name: "a", path: join(workspaceA, "snapshot") })],
				["b", makeResult(10, { name: "b", path: join(workspaceB, "snapshot") })],
			]),
		});

		expect(result?.passed).toBe(true);
		await expect(access(workspaceA)).rejects.toThrow();
		await expect(access(workspaceB)).rejects.toThrow();
	});
});
