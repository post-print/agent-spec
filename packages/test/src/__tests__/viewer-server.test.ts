import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerCatalog, ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import type { ViewerRunner } from "../viewer/run-controller.js";
import { listenViewer } from "../viewer/server.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function fixtureCatalog(): ViewerCatalog {
	return {
		suitesDir: "fixtures",
		defaultSelectedHosts: [],
		suites: [
			{
				name: "smoke",
				hosts: ["cursor"],
				scenarios: [{ name: "hello direct", prompt: "Say hello", rubric: {} }],
			},
		],
	};
}
function envelope(job: ViewerJob) {
	return {
		suite: job.suite,
		scenario: job.scenario,
		host: job.host,
		...(job.arm ? { arm: job.arm } : {}),
	};
}

const fakeRunner: ViewerRunner = {
	async runJob(job, emit) {
		const cell = envelope(job);
		emit({ type: "cell_started", ...cell });
		emit({ type: "prompt", text: job.prompt, ...cell });
		emit({ type: "text", text: "fake assistant reply", ...cell });
		emit({ type: "tool", name: "Read", args: { path: "README.md" }, ...cell });
		emit({ type: "cell_finished", ...cell, passed: true, durationMs: 4 });
		emit({
			type: "scenario_result",
			...cell,
			result: {
				suite: job.suite,
				scenario: job.scenario,
				passed: true,
				failures: [],
				durationMs: 4,
				trace: {
					messages: [{ role: "assistant", content: "fake assistant reply" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
			},
		});
	},
};

async function readSseEvents(url: string, headers?: HeadersInit): Promise<ViewerEvent[]> {
	const response = await fetch(url, { headers });
	expect(response.status).toBe(200);
	const body = await response.text();
	return body
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)) as ViewerEvent);
}

describe("viewer server", () => {
	it("serves the catalog page and streams a fake run", async () => {
		const catalog = fixtureCatalog();
		const handle = await listenViewer({
			catalog,
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
			runner: fakeRunner,
		});
		try {
			expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
			const page = await fetch(handle.url);
			expect(page.status).toBe(200);
			const html = await page.text();
			expect(html).toContain("<title>agent-test viewer</title>");
			expect(html).toContain("hello direct");
			expect(html).not.toContain("Select one or more hosts to start a run.");
			expect(html).toContain('"defaultWorkers":4');
			expect(html).toContain('"maxWorkers":32');
			expect(html).toContain("run-toggle run-cell");
			expect(html).toContain('id="viewer-root"');
			expect(html).toContain('id="bootstrap-data"');
			expect(html).toContain("live-status");
			expect(html).toContain("compare-tablist");
			expect(html).toContain("chat-running");
			expect(html).not.toContain('id="live-dock"');

			const catalogJson = await fetch(new URL("/api/catalog", handle.url));
			expect(catalogJson.status).toBe(200);
			const body = (await catalogJson.json()) as { suites: Array<{ name: string }> };
			expect(body.suites.some((suite) => suite.name === "smoke")).toBe(true);

			const started = await fetch(new URL("/api/runs", handle.url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					suite: "smoke",
					scenario: "hello direct",
					hosts: ["cursor"],
				}),
			});
			expect(started.status).toBe(202);
			const { runId } = (await started.json()) as { runId: string };
			const events = await readSseEvents(new URL(`/api/runs/${runId}/events`, handle.url).href);
			expect(events[0]).toEqual({ type: "run_started", runId });
			expect(
				events.some((event) => event.type === "text" && event.text === "fake assistant reply"),
			).toBe(true);
			expect(events.some((event) => event.type === "tool" && event.name === "Read")).toBe(true);
			expect(events.at(-1)).toMatchObject({ type: "run_finished", passed: 1, failed: 0 });
			const resumed = await readSseEvents(new URL(`/api/runs/${runId}/events`, handle.url).href, {
				"Last-Event-ID": "0",
			});
			expect(resumed).toHaveLength(events.length - 1);
			expect(resumed[0]).not.toMatchObject({ type: "run_started" });
			const runs = (await (await fetch(new URL("/api/runs", handle.url))).json()) as Array<{
				id: string;
			}>;
			expect(runs.map((run) => run.id)).toContain(runId);
			const detail = await fetch(new URL(`/api/runs/${runId}`, handle.url));
			expect(detail.status).toBe(200);
			expect(await detail.text()).toContain("fake assistant reply");
		} finally {
			await handle.close();
		}
	});

	it("imports a completed run and closes after its idle timeout", async () => {
		const catalog = fixtureCatalog();
		let markClosed: (() => void) | undefined;
		const closed = new Promise<void>((resolveClosed) => {
			markClosed = resolveClosed;
		});
		const handle = await listenViewer({
			catalog,
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
			runner: fakeRunner,
			initialRuns: [
				{
					id: "imported",
					request: { suite: "smoke" },
					status: "completed",
					startedAt: "2026-09-15T00:00:00.000Z",
					finishedAt: "2026-09-15T00:01:00.000Z",
					reports: [],
				},
			],
			selectedRunId: "imported",
			idleMs: 20,
			onClose: () => markClosed?.(),
		});
		const page = await (await fetch(handle.url)).text();
		expect(page).toContain("imported");
		await closed;
		await handle.close();
	});
});
