import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customAgent } from "@post-print/agent-harness";
import { TestRuntime } from "../sdk/runtime.js";

it("run.environment keeps counting a process from an earlier turn on a continuation", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-continuation-"));
	await mkdir(join(root, "fixture"));
	await writeFile(join(root, "fixture", "PROJECT.md"), "# Fixture\n");
	const lingering = customAgent({
		adapter: new URL("./fixtures/lingering-agent.mjs", import.meta.url).href,
		options: {},
	});
	const runtime = new TestRuntime({
		baseDir: root,
		outputDir: join(root, "output"),
		agent: lingering,
		workspace: "./fixture",
		signal: new AbortController().signal,
	});
	try {
		const first = await runtime.agent("task", { observeEnvironment: {} }).run({ prompt: "start" });
		const pid = Number(first.output);
		expect(first.environment?.processes.map((entry) => entry.pid)).toContain(pid);
		const second = await first.continue({ prompt: "clean up" });
		expect(second.environment?.processes.map((entry) => entry.pid)).toContain(pid);
	} finally {
		await runtime.close();
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
