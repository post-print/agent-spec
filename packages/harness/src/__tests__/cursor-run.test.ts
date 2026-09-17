import { expect, it, jest, mock } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentRunTimeoutError } from "../run-guards.js";

const agentCreate = jest.fn();
const agentSend = jest.fn();

mock.module("@cursor/sdk", () => ({
	Agent: {
		create: agentCreate,
	},
}));

it("runCursorAgent working directory › keeps shell work in the selected workspace", async () => {
	const prior = process.cwd();
	const workspace = await mkdtemp(join(tmpdir(), "cursor-run-cwd-"));
	let observed: string | undefined;
	agentCreate.mockResolvedValue({
		send: agentSend,
		[Symbol.asyncDispose]: async () => {},
	});
	agentSend.mockImplementation(async () => {
		observed = process.cwd();
		return {
			stream: async function* () {},
			wait: async () => ({ status: "finished" }),
		};
	});
	try {
		const { runCursorAgent } = await import("../cursor-run.js");
		await runCursorAgent({ cwd: workspace, prompt: "Test the workspace.", apiKey: "test-key" });
		expect(observed).toBe(await realpath(workspace));
		expect(process.cwd()).toBe(prior);
	} finally {
		process.chdir(prior);
		await rm(workspace, { recursive: true, force: true });
		jest.clearAllMocks();
	}
});

it("runCursorAgent onDeadlineStart › fires after Agent.create and before the harness deadline arms", async () => {
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

	await expect(run).rejects.toBeInstanceOf(AgentRunTimeoutError);

	expect(events).toEqual(["create", "create-done", "deadline-start", "stream"]);
	jest.clearAllMocks();
});

it("cancelActiveCursorRun › cancels the in-flight SDK run", async () => {
	const cancel = jest.fn(async () => {});
	const wait = jest.fn(async () => ({ status: "cancelled" }));
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

	while (agentSend.mock.calls.length === 0) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	cancelActiveCursorRun();
	releaseStream?.();

	await expect(runPromise).resolves.toMatchObject({ status: "failed" });
	expect(cancel).toHaveBeenCalled();
	jest.clearAllMocks();
});

it("cancelActiveCursorRun › is a no-op when no run is active", async () => {
	const { cancelActiveCursorRun } = await import("../cursor-run.js");
	expect(() => cancelActiveCursorRun()).not.toThrow();
});

it("runCursorAgent usage › prefers wait() cumulative usage on the finalized trace", async () => {
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
		authMode: "api-key",
	});
	expect(result.trace.usage).toEqual({
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	});
	expect(result.usage).toEqual(result.trace.usage);
	expect(agentCreate).toHaveBeenCalledWith(
		expect.objectContaining({
			apiKey: "test-key",
			local: { cwd: process.cwd(), settingSources: ["project"] },
		}),
	);
	jest.clearAllMocks();
});

it("runCursorAgent usage › adds the user setting source when user skills are allowed", async () => {
	agentCreate.mockResolvedValue({
		send: agentSend,
		[Symbol.asyncDispose]: async () => {},
	});
	agentSend.mockResolvedValue({
		stream: async function* () {},
		wait: async () => ({ status: "finished", usage: { inputTokens: 1, outputTokens: 1 } }),
	});
	const { runCursorAgent } = await import("../cursor-run.js");
	await runCursorAgent({
		cwd: process.cwd(),
		prompt: "test",
		apiKey: "test-key",
		includeGlobalSkills: true,
	});
	expect(agentCreate).toHaveBeenCalledWith(
		expect.objectContaining({
			local: { cwd: process.cwd(), settingSources: ["project", "user"] },
		}),
	);
	jest.clearAllMocks();
});

it("runCursorAgent usage › uses an isolated HOME when user skills stay out", async () => {
	const originalHome = process.env.HOME;
	let homeDuringCreate: string | undefined;
	agentCreate.mockImplementation(async () => {
		homeDuringCreate = process.env.HOME;
		return {
			send: agentSend,
			[Symbol.asyncDispose]: async () => {},
		};
	});
	agentSend.mockResolvedValue({
		stream: async function* () {},
		wait: async () => ({ status: "finished" }),
	});
	const { runCursorAgent } = await import("../cursor-run.js");
	await runCursorAgent({
		cwd: process.cwd(),
		prompt: "test",
		apiKey: "test-key",
	});
	expect(homeDuringCreate).toBeDefined();
	expect(homeDuringCreate).not.toBe(originalHome);
	expect(homeDuringCreate).toContain("agent-harness-cursor-home-");
	expect(process.env.HOME).toBe(originalHome);
	jest.clearAllMocks();
});

it("runCursorAgent usage › omits apiKey when CURSOR_AUTH_MODE=subscription", async () => {
	agentCreate.mockResolvedValue({
		send: agentSend,
		[Symbol.asyncDispose]: async () => {},
	});
	agentSend.mockResolvedValue({
		stream: async function* () {},
		wait: async () => ({ status: "finished" }),
	});

	const priorMode = process.env.CURSOR_AUTH_MODE;
	const priorKey = process.env.CURSOR_API_KEY;
	process.env.CURSOR_AUTH_MODE = "subscription";
	process.env.CURSOR_API_KEY = "stale-key";
	try {
		const { runCursorAgent } = await import("../cursor-run.js");
		await runCursorAgent({
			cwd: process.cwd(),
			prompt: "test",
			authMode: "subscription",
		});
		expect(agentCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				local: { cwd: process.cwd(), settingSources: ["project"] },
			}),
		);
		expect(agentCreate.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
	} finally {
		if (priorMode === undefined) {
			delete process.env.CURSOR_AUTH_MODE;
		} else {
			process.env.CURSOR_AUTH_MODE = priorMode;
		}
		if (priorKey === undefined) {
			delete process.env.CURSOR_API_KEY;
		} else {
			process.env.CURSOR_API_KEY = priorKey;
		}
		jest.clearAllMocks();
	}
});

it("runCursorAgent failure detail › propagates rawStatus and sdkError from wait()", async () => {
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
	jest.clearAllMocks();
});

it("runCursorAgent failure detail › adds a login hint when the SDK rejects the user API key", async () => {
	const { CURSOR_SDK_LOGIN_HINT } = await import("../cursor-auth.js");
	const { formatCursorRunFailure } = await import("../cursor-run.js");
	expect(
		formatCursorRunFailure({
			status: "failed",
			rawStatus: "error",
			sdkError: { message: "Invalid User API Key" },
		}),
	).toContain(CURSOR_SDK_LOGIN_HINT);
});

it("runCursorAgent failure detail › attaches partial trace on user-input failure", async () => {
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
	jest.clearAllMocks();
});

it("runCursorAgent keeps its SDK agent alive until the run settles", async () => {
	const events: string[] = [];
	agentCreate.mockResolvedValue({
		send: agentSend,
		[Symbol.asyncDispose]: async () => {
			events.push("disposed");
		},
	});
	agentSend.mockResolvedValue({
		stream: async function* () {
			await Promise.resolve();
			events.push("streamed");
			yield { type: "text", text: "Done." };
		},
		wait: async () => {
			events.push("settled");
			return { status: "finished" };
		},
	});
	try {
		const { runCursorAgent } = await import("../cursor-run.js");
		await runCursorAgent({ cwd: process.cwd(), prompt: "Complete the task.", apiKey: "test-key" });
		expect(events).toEqual(["streamed", "settled", "disposed"]);
	} finally {
		jest.clearAllMocks();
	}
});
