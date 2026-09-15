import { describe, expect, it } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DetachedViewerManifest } from "../report-preview.js";
import { startViewerSessionServer } from "../viewer/session-server.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("detached viewer session server", () => {
	it("imports a report, reloads the whole catalog, and removes its private manifest on idle", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-"));
		const manifestPath = join(directory, "session.json");
		const manifest: DetachedViewerManifest = {
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
			request: { suite: "smoke", scenario: "hello direct", hosts: ["cursor"] },
			reports: [
				{
					suite: "smoke",
					host: "cursor",
					passed: 1,
					failed: 0,
					skipped: 0,
					results: [
						{
							suite: "smoke",
							scenario: "hello direct",
							passed: true,
							failures: [],
							durationMs: 4,
						},
					],
				},
			],
		};
		await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

		const url = await startViewerSessionServer(manifestPath, 40);
		const html = await (await fetch(url)).text();
		expect(html).toContain("hello direct");
		expect(html).toContain("mcp echo tool");
		expect(html).toContain("run-imported-");
		expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);

		await Bun.sleep(100);
		expect(stat(directory)).rejects.toThrow();
	});
});
