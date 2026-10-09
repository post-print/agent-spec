import { expect, it } from "bun:test";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customAgent, WorkspaceEscapeError } from "@post-print/agent-harness";
import { z } from "zod/v4";
import { TestRuntime } from "../sdk/runtime.js";

const FAKE_AGENT = new URL("../../fixtures/sdk-v2/fake-agent.mjs", import.meta.url).href;

async function judgeRuntime(options: Record<string, unknown>) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "agent-test-judge-isolation-")));
	const outputDir = join(root, "agent-runs");
	const runtime = new TestRuntime({
		baseDir: root,
		outputDir,
		judge: customAgent({ adapter: FAKE_AGENT, options }),
		workspace: ".",
		signal: new AbortController().signal,
	});
	const reviewer = runtime.judge("review", {
		prompt: "Is it correct?",
		schema: z.object({ correct: z.boolean() }),
	});
	return { root, outputDir, runtime, reviewer };
}

it("judge isolation › reviewer works in a sealed Git root outside the run artifacts", async () => {
	const record = join(await mkdtemp(join(tmpdir(), "judge-record-")), "workspace.json");
	const { root, outputDir, runtime, reviewer } = await judgeRuntime({ recordWorkspace: record });
	try {
		await reviewer.run({ input: { answer: "Mina" } });
		const observed = JSON.parse(await readFile(record, "utf8")) as {
			path: string;
			hasGit: boolean;
		};
		expect(observed.hasGit).toBe(true);
		expect(observed.path.startsWith(outputDir)).toBe(false);
		expect(observed.path.startsWith(root)).toBe(false);
	} finally {
		await runtime.close();
	}
});

it("judge isolation › a reviewer that reads run evidence is rejected", async () => {
	const { runtime, reviewer } = await judgeRuntime({ reviewerRead: "../../agent-runs/run.json" });
	try {
		const result = reviewer.run({ input: { answer: "Mina" } });
		await expect(result).rejects.toBeInstanceOf(WorkspaceEscapeError);
	} finally {
		await runtime.close();
	}
});
