import { expect, it } from "bun:test";

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

it("viewer run controller › runs compare arms in parallel on one host, then the next host", async () => {
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

it("viewer run controller › rejects an explicitly empty host selection", () => {
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

it("viewer run controller › caps parallel jobs with maxParallelAgents", async () => {
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

it("viewer run controller › uses a requested worker limit below the viewer maximum", async () => {
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
	const controller = createViewerRunController({ catalog, runner, maxParallelAgents: 2 });
	const { runId } = controller.start({
		suite: "smoke",
		scenario: "pair",
		hosts: ["cursor"],
		workers: 1,
	});
	await waitForHistory(controller, runId);
	expect(peak).toBe(1);
	expect(() => controller.start({ suite: "smoke", scenario: "pair", workers: 3 })).toThrow(
		"workers must be an integer 1-2",
	);
});

it("viewer run controller › waits for the shared compare finalizer before publishing the authoritative result", async () => {
	let finalized = 0;
	let receivedWorkspaces: string[] = [];
	const runner: ViewerRunner = {
		runJob: runWithJudgeWorkspace,
		async finalizeCompare(input) {
			finalized += 1;
			receivedWorkspaces = [...input.armResults.values()]
				.map((result) => result.judgeWorkspace?.name)
				.filter((name): name is string => name !== undefined);
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
	expect(receivedWorkspaces).toEqual(["a", "b"]);
	expect(controller.run(runId)?.reports[0]?.results[0]?.judgeVerdicts?.[0]?.id).toBe("shared");
	expect(events.some((event) => event.type === "scenario_result" && event.arm === undefined)).toBe(
		true,
	);
});

it("viewer run controller › waits for the scenario finalizer before completing a viewer run", async () => {
	const runner: ViewerRunner = {
		runJob: runPassingScenario,
		async finalizeScenario(input, emit) {
			emit({
				type: "judge_started",
				suite: input.suite,
				scenario: input.scenario.name,
				host: input.host,
				id: "quality",
				question: "Did it work?",
			});
			emit({
				type: "judge_text",
				suite: input.suite,
				scenario: input.scenario.name,
				host: input.host,
				id: "quality",
				question: "Did it work?",
				text: '{"verdict":"yes"}',
			});
			return {
				...input.result,
				judgeVerdicts: [
					{
						id: "quality",
						question: "Did it work?",
						pass: true,
						rationale: "It worked.",
					},
				],
			};
		},
	};
	const controller = createViewerRunController({ catalog, runner });
	const { runId } = controller.start({ suite: "smoke", scenario: "hello" });
	const events = await waitForHistory(controller, runId);

	expect(controller.run(runId)?.reports[0]?.results[0]?.judgeVerdicts?.[0]?.id).toBe("quality");
	expect(events.some((event) => event.type === "judge_started")).toBe(true);
	expect(events.some((event) => event.type === "judge_text")).toBe(true);
	expect(events.at(-1)).toMatchObject({ type: "run_finished", passed: 1, failed: 0 });
});

it("viewer run controller › publishes the post-judge cell status", async () => {
	const runner: ViewerRunner = {
		async runJob(job, emit) {
			emit({
				type: "cell_finished",
				suite: job.suite,
				scenario: job.scenario,
				host: job.host,
				passed: true,
				durationMs: 2,
			});
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
					durationMs: 2,
				},
			});
		},
		async finalizeScenario(input) {
			return {
				...input.result,
				passed: false,
				failures: [{ matcher: "judge", message: "judge unavailable", category: "judge_infra" }],
			};
		},
	};
	const controller = createViewerRunController({ catalog, runner });
	const { runId } = controller.start({ suite: "smoke", scenario: "hello" });
	const events = await waitForHistory(controller, runId);
	const completions = events.filter((event) => event.type === "cell_finished");

	expect(completions).toHaveLength(2);
	expect(completions.at(-1)).toMatchObject({ passed: false, failures: [{ matcher: "judge" }] });
	expect(controller.run(runId)?.reports[0]?.results[0]?.passed).toBe(false);
});

it("viewer run controller › starts a scenario judge before unrelated agent jobs finish", async () => {
	let releaseSecondJob: () => void = () => undefined;
	const secondJob = new Promise<void>((resolve) => {
		releaseSecondJob = resolve;
	});
	const events: string[] = [];
	const twoScenarioCatalog: ViewerCatalog = {
		suitesDir: catalog.suitesDir,
		defaultSelectedHosts: ["cursor"],
		suites: [
			{
				name: "smoke",
				hosts: ["cursor"],
				scenarios: [
					{ name: "first", prompt: "First", rubric: { judge: ["Did it work?"] } },
					{ name: "second", prompt: "Second", rubric: {} },
				],
			},
		],
	};
	const runner: ViewerRunner = concurrentScenarioRunner(secondJob, events);
	const controller = createViewerRunController({ catalog: twoScenarioCatalog, runner });
	const { runId } = controller.start({ suite: "smoke", hosts: ["cursor"] });
	for (let attempt = 0; attempt < 20 && events.length === 0; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	expect(events).toEqual(["judge:first"]);
	expect(controller.history(runId)?.some((event) => event.type === "run_finished")).toBe(false);
	releaseSecondJob();
	await waitForHistory(controller, runId);
});

it("viewer run controller › followViewerRun keeps events that arrive during the first flush", async () => {
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

it("viewer run controller › cancels an in-flight job", async () => {
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

it("viewer run controller › keeps imported and newly completed runs as immutable session history", async () => {
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

it("finalizes ready comparisons before unrelated jobs and suppresses cancelled verdicts", async () => {
	let releaseOther = () => {};
	let releaseJudge = () => {};
	const other = new Promise<void>((resolve) => {
		releaseOther = resolve;
	});
	const judge = new Promise<void>((resolve) => {
		releaseJudge = resolve;
	});
	let judging = 0;
	const controller = createViewerRunController({
		catalog,
		maxParallelAgents: 3,
		runner: delayedComparisonRunner(other, judge, () => {
			judging++;
		}),
	});
	const { runId } = controller.start({ suite: "smoke", hosts: ["cursor"] });
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(judging).toBe(1);
	expect(controller.history(runId)?.some((e) => e.type === "scenario_finalizing")).toBe(true);
	expect(controller.run(runId)?.reports.flatMap((r) => r.results)).toEqual([]);
	controller.cancel(runId);
	expect(controller.run(runId)?.status).toBe("cancelling");
	releaseJudge();
	releaseOther();
	const events = await waitForHistory(controller, runId);
	expect(
		events.filter((e) => e.type === "scenario_result" && !e.arm && e.scenario === "pair"),
	).toHaveLength(0);
	expect(events.at(-1)).toMatchObject({ type: "run_finished", status: "cancelled" });
});

const runWithJudgeWorkspace: ViewerRunner["runJob"] = async (job, emit) => {
	const result = {
		suite: job.suite,
		scenario: job.scenario,
		passed: true,
		failures: [],
		durationMs: 2,
	};
	Object.defineProperty(result, "judgeWorkspace", {
		value: { name: job.arm ?? "scenario", path: `/tmp/${job.arm}` },
		enumerable: false,
	});
	emit({
		type: "scenario_result",
		suite: job.suite,
		scenario: job.scenario,
		host: job.host,
		arm: job.arm,
		result,
	});
};

const runPassingScenario: ViewerRunner["runJob"] = async (job, emit) => {
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
			durationMs: 2,
		},
	});
};

function concurrentScenarioRunner(secondJob: Promise<void>, events: string[]): ViewerRunner {
	return {
		async runJob(job, emit) {
			if (job.scenario === "second") {
				await secondJob;
			}
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
					durationMs: 1,
				},
			});
		},
		async finalizeScenario(input, emit) {
			events.push(`judge:${input.scenario.name}`);
			emit({
				type: "judge_started",
				suite: input.suite,
				scenario: input.scenario.name,
				host: input.host,
				id: "quality",
				question: "Did it work?",
			});
			return input.result;
		},
	};
}

function delayedComparisonRunner(
	other: Promise<void>,
	judge: Promise<void>,
	onJudge: () => void,
): ViewerRunner {
	return {
		async runJob(job, emit) {
			if (!job.arm) await other;
			emit({
				type: "scenario_result",
				...job,
				result: {
					suite: job.suite,
					scenario: job.scenario,
					passed: true,
					failures: [],
					durationMs: 1,
				},
			});
		},
		async finalizeCompare(input) {
			onJudge();
			await judge;
			return {
				suite: input.suite,
				scenario: input.scenario.name,
				passed: true,
				failures: [],
				durationMs: 1,
			};
		},
	};
}
