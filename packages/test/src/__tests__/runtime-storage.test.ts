import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customAgent } from "@post-print/agent-harness";
import { TestRuntime } from "../sdk/runtime.js";

async function runtimeFixture() {
	const root = await mkdtemp(join(tmpdir(), "runtime-storage-"));
	await mkdir(join(root, "source"));
	await writeFile(join(root, "source", "original.txt"), "original");
	let announce: (() => void) | undefined;
	const changed = new Promise<void>((resolve) => {
		announce = resolve;
	});
	const runtime = new TestRuntime({
		baseDir: root,
		outputDir: join(root, "runs"),
		workspace: "source",
		signal: new AbortController().signal,
		agent: customAgent({
			adapter: new URL("./fixtures/storage-agent.mjs", import.meta.url).href,
			options: {},
		}),
		onEvent: (event) => {
			if (event.type === "agent") announce?.();
		},
	});
	return { root, runtime, changed, fixture: runtime.agent("writer", {}) };
}
for (const outcome of ["pass", "fail", "wait"]) {
	it(`runtime source recovery and snapshot teardown survive ${outcome}`, async () => {
		const f = await runtimeFixture();
		try {
			const pending = f.fixture.run({ prompt: outcome });
			const settled = pending.catch(() => undefined);
			await f.changed;
			if (outcome === "wait") await f.runtime.close();
			await settled;
			await f.runtime.close();
			const [id] = await readdir(join(f.root, "runs"));
			if (!id) throw new Error("Missing operation artifacts");
			const directory = join(f.root, "runs", id);
			expect(await readFile(join(directory, "changed-files", "changed.txt"), "utf8")).toBe(
				"recoverable source",
			);
			expect(JSON.parse(await readFile(join(directory, "changes.json"), "utf8"))).toMatchObject({
				changes: { "changed.txt": "preserved" },
			});
			await expect(readdir(join(directory, "initial"))).rejects.toThrow();
			if (outcome !== "pass") await expect(pending).rejects.toThrow();
		} finally {
			await f.runtime.close();
			await rm(f.root, { recursive: true, force: true });
		}
	});
}
