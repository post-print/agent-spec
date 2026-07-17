import { describe, expect, it, vi } from "vitest";

import { AgentRunTimeoutError } from "../run-guards.js";

const agentCreate = vi.fn();
const agentSend = vi.fn();

vi.mock("@cursor/sdk", () => ({
	Agent: {
		create: agentCreate,
	},
}));

describe("runCursorAgent onDeadlineStart", () => {
	it("fires after Agent.create and before the harness deadline arms", async () => {
		vi.useFakeTimers();
		const events: string[] = [];

		agentCreate.mockImplementation(async () => {
			events.push("create");
			await new Promise((resolve) => setTimeout(resolve, 40));
			events.push("create-done");
			return {
				send: agentSend,
				[Symbol.asyncDispose]: async () => {},
			};
		});

		agentSend.mockImplementation(async () => ({
			stream: async function* () {
				events.push("stream");
				await new Promise((resolve) => setTimeout(resolve, 200));
			},
			wait: async () => ({ status: "finished" }),
		}));

		const { runCursorAgent } = await import("../cursor-run.js");
		const run = runCursorAgent({
			cwd: process.cwd(),
			prompt: "test",
			apiKey: "test-key",
			timeoutMs: 50,
			onDeadlineStart: async () => {
				events.push("deadline-start");
			},
		});

		const expectation = expect(run).rejects.toBeInstanceOf(AgentRunTimeoutError);
		await vi.advanceTimersByTimeAsync(40);
		await vi.advanceTimersByTimeAsync(50);
		await expectation;

		expect(events).toEqual(["create", "create-done", "deadline-start", "stream"]);
		vi.useRealTimers();
		vi.clearAllMocks();
	});
});

describe("cancelActiveCursorRun", () => {
	it("cancels the in-flight SDK run", async () => {
		const cancel = vi.fn(async () => {});
		const wait = vi.fn(async () => ({ status: "cancelled" }));
		let releaseStream: (() => void) | undefined;

		agentCreate.mockResolvedValue({
			send: agentSend,
			[Symbol.asyncDispose]: async () => {},
		});
		agentSend.mockResolvedValue({
			stream: async function* () {
				await new Promise<void>((resolve) => {
					releaseStream = resolve;
				});
			},
			wait,
			supports: (op: string) => op === "cancel",
			cancel,
		});

		const { cancelActiveCursorRun, runCursorAgent } = await import("../cursor-run.js");
		const runPromise = runCursorAgent({
			cwd: process.cwd(),
			prompt: "test",
			apiKey: "test-key",
		});

		await vi.waitFor(() => {
			expect(agentSend).toHaveBeenCalled();
		});
		cancelActiveCursorRun();
		releaseStream?.();

		await expect(runPromise).resolves.toMatchObject({ status: "failed" });
		expect(cancel).toHaveBeenCalled();
		vi.clearAllMocks();
	});

	it("is a no-op when no run is active", async () => {
		const { cancelActiveCursorRun } = await import("../cursor-run.js");
		expect(() => cancelActiveCursorRun()).not.toThrow();
	});
});
