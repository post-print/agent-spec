import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customAgent } from "@post-print/agent-harness";
import { z } from "zod/v4";
import { TestRuntime } from "../sdk/runtime.js";

it("runtime events › announces a judge before evaluation completes", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-runtime-events-"));
	let announce: ((event: { runId: string; type: string; value: unknown }) => void) | undefined;
	const announced = new Promise<{ runId: string; type: string; value: unknown }>((resolve) => {
		announce = resolve;
	});
	const fake = customAgent({
		adapter: new URL("../../fixtures/sdk-v2/fake-agent.mjs", import.meta.url).href,
		options: {},
	});
	const runtime = new TestRuntime({
		baseDir: root,
		outputDir: root,
		judge: fake,
		workspace: root,
		signal: new AbortController().signal,
		onEvent: (event) => {
			if (event.type === "evaluation-start") announce?.(event);
		},
	});
	const run = runtime
		.judge("releaseAdvice", {
			prompt: "Should this release proceed?",
			schema: z.object({ safe: z.boolean() }),
		})
		.run({ input: "WAIT_FOREVER" });
	try {
		const event = await Promise.race([
			announced,
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("Judge was not announced while running")), 500),
			),
		]);
		expect(event.type).toBe("evaluation-start");
		expect(event.value).toMatchObject({
			name: "releaseAdvice",
			input: "WAIT_FOREVER",
			evaluation: { prompt: "Should this release proceed?" },
		});
	} finally {
		await runtime.close();
		await expect(run).rejects.toThrow();
		await rm(root, { recursive: true, force: true });
	}
});
