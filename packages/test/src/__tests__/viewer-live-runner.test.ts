import { describe, expect, it } from "bun:test";

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
			spawnLiveScenario: async () => {
				order.push("spawn");
				return { exitCode: 0, stderr: "" };
			},
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
		expect(events.at(-1)).toMatchObject({ type: "cell_finished", passed: false });
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
});
