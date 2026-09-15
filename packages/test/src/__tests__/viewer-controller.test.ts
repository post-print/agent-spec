import { describe, expect, it } from "bun:test";

import type { ViewerCatalog, ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import {
	createViewerRunController,
	followViewerRun,
	type ViewerRunner,
} from "../viewer/run-controller.js";

const catalog: ViewerCatalog = {
	suitesDir: "/tmp/suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "smoke",
			hosts: ["cursor", "claude"],
			scenarios: [
				{ name: "hello", prompt: "Say smoke ok.", rubric: { must: ["smoke ok"] } },
				{
					name: "pair",
					prompt: "Read word.txt.",
					rubric: {},
					compare: [
						{ id: "a", label: "alpha", prompt: "Read alpha.", rubric: {} },
						{ id: "b", label: "beta", prompt: "Read beta.", rubric: {} },
					],
				},
			],
		},
	],
};

async function waitForHistory(
	controller: ReturnType<typeof createViewerRunController>,
	runId: string,
): Promise<ViewerEvent[]> {
	for (let attempt = 0; attempt < 200; attempt++) {
		const events = controller.history(runId) ?? [];
		if (events.some((event) => event.type === "run_finished")) {
			return events;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 5));
	}
	throw new Error("viewer run did not finish");
}

describe("viewer run controller", () => {
	it("runs compare arms in parallel on one host, then the next host", async () => {
		const order: string[] = [];
		const started: string[] = [];
		const runner: ViewerRunner = {
			async runJob(job: ViewerJob, emit) {
				started.push(`${job.host}:${job.arm ?? "_"}`);
				order.push(`start:${job.host}:${job.arm ?? "_"}`);
				await Promise.resolve();
				order.push(`end:${job.host}:${job.arm ?? "_"}`);
				emit({
					type: "cell_finished",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					arm: job.arm,
					passed: true,
					durationMs: 1,
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner, maxParallelAgents: 4 });
		const { runId } = controller.start({
			suite: "smoke",
			scenario: "pair",
			hosts: ["cursor", "claude"],
			parallelHosts: false,
		});
		const events = await waitForHistory(controller, runId);
		expect(started.slice(0, 2).sort()).toEqual(["cursor:a", "cursor:b"]);
		expect(started.slice(2).sort()).toEqual(["claude:a", "claude:b"]);
		expect(events[0]).toEqual({ type: "run_started", runId });
		expect(events.at(-1)).toMatchObject({ type: "run_finished", passed: 4, failed: 0 });
	});

	it("rejects an explicitly empty host selection", () => {
		const started: string[] = [];
		const runner: ViewerRunner = {
			async runJob(job, emit) {
				started.push(job.host);
				emit({
					type: "cell_finished",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					arm: job.arm,
					passed: true,
					durationMs: 1,
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner });
		expect(() =>
			controller.start({
				suite: "smoke",
				scenario: "hello",
				hosts: [],
			}),
		).toThrow("No matching scenarios to run");
		expect(started).toEqual([]);
	});

	it("caps parallel jobs with maxParallelAgents", async () => {
		let current = 0;
		let peak = 0;
		const runner: ViewerRunner = {
			async runJob(job, emit) {
				current += 1;
				peak = Math.max(peak, current);
				await new Promise((resolveWait) => setTimeout(resolveWait, 20));
				current -= 1;
				emit({
					type: "cell_finished",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					arm: job.arm,
					passed: true,
					durationMs: 1,
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner, maxParallelAgents: 1 });
		const { runId } = controller.start({
			suite: "smoke",
			scenario: "pair",
			hosts: ["cursor"],
		});
		await waitForHistory(controller, runId);
		expect(peak).toBe(1);
	});

	it("waits for the shared compare finalizer before publishing the authoritative result", async () => {
		let finalized = 0;
		const runner: ViewerRunner = {
			async runJob(job, emit) {
				emit({
					type: "scenario_result",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					arm: job.arm,
					result: {
						suite: job.suite,
						scenario: job.scenario,
						passed: true,
						failures: [],
						durationMs: 2,
					},
				});
			},
			async finalizeCompare(input) {
				finalized += 1;
				return {
					suite: input.suite,
					scenario: input.scenario.name,
					passed: true,
					failures: [],
					durationMs: 3,
					judgeVerdicts: [
						{
							id: "shared",
							question: "Did both arms work?",
							pass: true,
							rationale: "Both worked.",
						},
					],
				};
			},
		};
		const controller = createViewerRunController({ catalog, runner });
		const { runId } = controller.start({ suite: "smoke", scenario: "pair" });
		const events = await waitForHistory(controller, runId);

		expect(finalized).toBe(1);
		expect(controller.run(runId)?.reports[0]?.results[0]?.judgeVerdicts?.[0]?.id).toBe("shared");
		expect(
			events.some((event) => event.type === "scenario_result" && event.arm === undefined),
		).toBe(true);
	});

	it("followViewerRun keeps events that arrive during the first flush", async () => {
		let emitJob: ((event: ViewerEvent) => void) | undefined;
		const runner: ViewerRunner = {
			async runJob(_job, emit, signal) {
				emitJob = emit;
				await new Promise<void>((resolveWait) => {
					if (signal.aborted) {
						resolveWait();
						return;
					}
					signal.addEventListener("abort", () => resolveWait(), { once: true });
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner });
		const { runId } = controller.start({
			suite: "smoke",
			scenario: "hello",
			hosts: ["cursor"],
		});
		await new Promise((resolveWait) => setTimeout(resolveWait, 5));
		expect(emitJob).toBeTypeOf("function");
		const seen: ViewerEvent["type"][] = [];
		const stop = followViewerRun(controller, runId, (event) => {
			seen.push(event.type);
			if (event.type === "run_started") {
				emitJob?.({
					type: "cell_started",
					suite: "smoke",
					scenario: "hello",
					host: "cursor",
				});
			}
		});
		expect(stop).toBeTypeOf("function");
		expect(seen).toEqual(["run_started", "cell_started"]);
		stop?.();
		controller.cancel(runId);
		await waitForHistory(controller, runId);
	});

	it("cancels an in-flight job", async () => {
		let aborted = false;
		const runner: ViewerRunner = {
			async runJob(_job, _emit, signal) {
				await new Promise<void>((resolveWait) => {
					if (signal.aborted) {
						aborted = true;
						resolveWait();
						return;
					}
					signal.addEventListener(
						"abort",
						() => {
							aborted = true;
							resolveWait();
						},
						{ once: true },
					);
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner });
		const { runId } = controller.start({ suite: "smoke", scenario: "hello", hosts: ["cursor"] });
		expect(controller.cancel(runId)).toBe(true);
		await waitForHistory(controller, runId);
		expect(aborted).toBe(true);
		expect(controller.run(runId)?.status).toBe("cancelled");
	});

	it("keeps imported and newly completed runs as immutable session history", async () => {
		const imported = {
			id: "imported",
			request: { suite: "smoke" },
			status: "completed" as const,
			startedAt: "2026-09-15T00:00:00.000Z",
			finishedAt: "2026-09-15T00:01:00.000Z",
			reports: [],
		};
		const runner: ViewerRunner = {
			async runJob(job, emit) {
				emit({
					type: "scenario_result",
					suite: job.suite,
					scenario: job.scenario,
					host: job.host,
					result: {
						suite: job.suite,
						scenario: job.scenario,
						passed: true,
						failures: [],
						durationMs: 4,
					},
				});
			},
		};
		const controller = createViewerRunController({ catalog, runner, initialRuns: [imported] });
		const { runId } = controller.start({ suite: "smoke", scenario: "hello" });
		await waitForHistory(controller, runId);
		expect(controller.runs().map((run) => run.id)).toEqual(["imported", runId]);
		expect(controller.run(runId)).toMatchObject({ status: "completed", reports: [{ passed: 1 }] });
		const snapshot = controller.run("imported");
		if (snapshot) snapshot.status = "cancelled";
		expect(controller.run("imported")?.status).toBe("completed");
	});
});
