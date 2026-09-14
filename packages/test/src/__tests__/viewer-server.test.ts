import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViewerJob } from "../viewer/catalog.js";
import { loadViewerCatalog } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import type { ViewerRunner } from "../viewer/run-controller.js";
import { listenViewer } from "../viewer/server.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

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
	},
};

async function readSseEvents(url: string): Promise<ViewerEvent[]> {
	const response = await fetch(url);
	expect(response.status).toBe(200);
	const body = await response.text();
	return body
		.split("\n")
		.filter((line) => line.startsWith("data: "))
		.map((line) => JSON.parse(line.slice(6)) as ViewerEvent);
}

describe("viewer server", () => {
	it("serves the catalog page and streams a fake run", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
		});
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
			expect(html).toContain("Suite viewer");
			expect(html).toContain("hello direct");
			expect(html).toContain("Run starts a live host agent.");
			expect(html).toContain('class="primary run-cell"');
			expect(html).toContain('data-live-slot="smoke::hello direct"');
			expect(html).toContain("live-status");
			expect(html).toContain("compare-tablist");
			expect(html).toContain("chat-running");
			expect(html).toContain("source.close()");
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
		} finally {
			await handle.close();
		}
	});
});
