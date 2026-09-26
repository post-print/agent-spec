import { expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { type AgentEvent, createAgentSession, openai } from "../../dist/index.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-codex-hang.mjs", import.meta.url));

it("public session timeout stops a stalled builtin after retaining progress", async () => {
	await chmod(fixture, 0o755);
	const previousBin = process.env.CODEX_BIN;
	process.env.CODEX_BIN = fixture;
	const controller = new AbortController();
	const events: AgentEvent[] = [];
	const session = await createAgentSession({
		agent: openai({ timeoutMs: 75 }),
		workspace: process.cwd(),
		signal: controller.signal,
	});
	const run = session.run("Start, emit progress, then stall.", (event) => events.push(event));
	let guard: ReturnType<typeof setTimeout> | undefined;
	try {
		const observed = Promise.race([
			run,
			new Promise<never>((_, reject) => {
				guard = setTimeout(
					() => reject(new Error("session timeout regression guard expired")),
					750,
				);
			}),
		]);
		await expect(observed).rejects.toMatchObject({
			kind: "infrastructure",
			code: "timeout",
			timeoutMs: 75,
			message: "agent timed out after 75ms waiting for run completion",
		});
		expect(events).toContainEqual({ type: "text", text: "Progress before the stall." });
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "trace",
				trace: expect.objectContaining({
					messages: [expect.objectContaining({ content: "Progress before the stall." })],
				}),
			}),
		);
	} finally {
		if (guard) clearTimeout(guard);
		controller.abort();
		await run.catch(() => undefined);
		await session.close().catch(() => undefined);
		if (previousBin === undefined) delete process.env.CODEX_BIN;
		else process.env.CODEX_BIN = previousBin;
	}
});
