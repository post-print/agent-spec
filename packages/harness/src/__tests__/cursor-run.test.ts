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
			wait: async () => ({
				status: "finished",
				usage: {
					inputTokens: 1,
					outputTokens: 2,
					totalTokens: 3,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			}),
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

describe("runCursorAgent usage", () => {
	it("prefers wait() cumulative usage on the finalized trace", async () => {
		agentCreate.mockResolvedValue({
			send: agentSend,
			[Symbol.asyncDispose]: async () => {},
		});
		agentSend.mockResolvedValue({
			stream: async function* () {
				yield {
					type: "usage",
					usage: {
						inputTokens: 1,
						outputTokens: 1,
						totalTokens: 2,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				};
			},
			wait: async () => ({
				status: "finished",
				usage: {
					inputTokens: 10,
					outputTokens: 20,
					totalTokens: 30,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			}),
		});

		const { runCursorAgent } = await import("../cursor-run.js");
		const result = await runCursorAgent({
			cwd: process.cwd(),
			prompt: "test",
			apiKey: "test-key",
		});
		expect(result.trace.usage).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			totalTokens: 30,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		vi.clearAllMocks();
	});
});

describe("runCursorAgent failure detail", () => {
	it("propagates rawStatus and sdkError from wait()", async () => {
		agentCreate.mockResolvedValue({
			send: agentSend,
			[Symbol.asyncDispose]: async () => {},
		});
		agentSend.mockResolvedValue({
			stream: async function* () {
				yield {
					type: "assistant",
					message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
				};
			},
			wait: async () => ({
				status: "error",
				error: { message: "upstream abort", code: "ABORT" },
			}),
		});

		const { formatCursorRunFailure, runCursorAgent } = await import("../cursor-run.js");
		const result = await runCursorAgent({
			cwd: process.cwd(),
			prompt: "test",
			apiKey: "test-key",
		});
		expect(result.status).toBe("failed");
		expect(result.rawStatus).toBe("error");
		expect(result.sdkError).toEqual({ message: "upstream abort", code: "ABORT" });
		expect(result.trace.messages.length).toBeGreaterThan(0);
		expect(formatCursorRunFailure(result)).toContain("upstream abort");
		vi.clearAllMocks();
	});

	it("attaches partial trace on user-input failure", async () => {
		agentCreate.mockResolvedValue({
			send: agentSend,
			[Symbol.asyncDispose]: async () => {},
		});
		agentSend.mockResolvedValue({
			stream: async function* () {
				yield {
					type: "tool_call",
					name: "AskQuestion",
					args: { prompt: "continue?" },
				};
			},
			wait: async () => ({ status: "finished" }),
		});

		const { runCursorAgent } = await import("../cursor-run.js");
		const { UserInputRequiredError } = await import("../run-guards.js");
		await expect(
			runCursorAgent({
				cwd: process.cwd(),
				prompt: "test",
				apiKey: "test-key",
			}),
		).rejects.toMatchObject({
			name: "UserInputRequiredError",
			trace: expect.objectContaining({
				toolCalls: expect.arrayContaining([expect.objectContaining({ name: "AskQuestion" })]),
			}),
		});
		expect(UserInputRequiredError).toBeDefined();
		vi.clearAllMocks();
	});
});
