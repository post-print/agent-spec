import { describe, expect, it } from "bun:test";

import type { ViewerCatalog, ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import { createViewerRunController, type ViewerRunner } from "../viewer/run-controller.js";

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
						{ id: "a", label: "alpha" },
						{ id: "b", label: "beta" },
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
	});
});
