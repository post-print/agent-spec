import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaudeAdapter } from "../adapters/index.js";
import { buildClaudeEnv, CLAUDE_AUTH_MODE_ENV, parseClaudeAuthMode } from "../claude-run.js";
import { AgentRunTimeoutError, UserInputRequiredError } from "../run-guards.js";
import type { LoadedContext } from "../types.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
	const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
	return {
		...actual,
		spawn: spawnMock,
	};
});

function emptyContext(): LoadedContext {
	return {
		profile: "claude",
		cwd: process.cwd(),
		sources: [],
		preamble: "preamble",
	};
}

function mockChild(options?: {
	lines?: string[];
	exitCode?: number;
	delayMs?: number;
	stderr?: string;
	hang?: boolean;
}): EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	pid: number;
	kill: ReturnType<typeof vi.fn>;
} {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		pid: number;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	// Invalid pid so killClaudeChild skips process.kill(-pid) process-group signaling.
	Object.defineProperty(child, "pid", { value: undefined, configurable: true });
	child.kill = vi.fn(() => {
		child.stdout.destroy();
		child.stderr.destroy();
		queueMicrotask(() => child.emit("close", null));
		return true;
	});

	if (options?.hang) {
		return child;
	}

	const delayMs = options?.delayMs ?? 0;
	queueMicrotask(async () => {
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		if (child.stdout.destroyed) {
			return;
		}
		for (const line of options?.lines ?? []) {
			child.stdout.write(`${line}\n`);
		}
		if (options?.stderr) {
			child.stderr.write(options.stderr);
		}
		child.stdout.end();
		child.stderr.end();
		child.emit("close", options?.exitCode ?? 0);
	});

	return child;
}

describe("runClaudeAgent", () => {
	afterEach(() => {
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env[CLAUDE_AUTH_MODE_ENV];
		spawnMock.mockReset();
	});

	it("rejects an unset or unknown auth mode instead of picking one", () => {
		expect(() => parseClaudeAuthMode(undefined)).toThrow(/not set/);
		expect(() => parseClaudeAuthMode("   ")).toThrow(/not set/);
		expect(() => parseClaudeAuthMode("subscription-ish")).toThrow(/invalid/);
		expect(parseClaudeAuthMode("api-key")).toBe("api-key");
		expect(parseClaudeAuthMode(" subscription ")).toBe("subscription");
	});

	it("fails an api-key run when ANTHROPIC_API_KEY is unset", async () => {
		process.env[CLAUDE_AUTH_MODE_ENV] = "api-key";
		delete process.env.ANTHROPIC_API_KEY;
		const adapter = new ClaudeAdapter();
		const session = await adapter.run({
			host: "claude",
			cwd: process.cwd(),
			context: emptyContext(),
			prompt: "hi",
		});
		expect(session.status).toBe("failed");
		expect(session.error).toMatch(/ANTHROPIC_API_KEY/);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("fails a run when CLAUDE_AUTH_MODE is unset", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const adapter = new ClaudeAdapter();
		const session = await adapter.run({
			host: "claude",
			cwd: process.cwd(),
			context: emptyContext(),
			prompt: "hi",
		});
		expect(session.status).toBe("failed");
		expect(session.error).toMatch(/CLAUDE_AUTH_MODE not set/);
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("passes the key through in api-key mode", () => {
		const env = buildClaudeEnv("api-key", "sk-ant-test");
		expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
	});

	it("strips a stale key in subscription mode", () => {
		// --bare never reads OAuth or the keychain, so a stale key left in the
		// parent shell would silently bill the API instead of the plan.
		const env = buildClaudeEnv("subscription", "sk-ant-stale");
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("maps a successful stream-json run", async () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env[CLAUDE_AUTH_MODE_ENV] = "api-key";
		spawnMock.mockImplementation(() =>
			mockChild({
				lines: [
					JSON.stringify({
						type: "assistant",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "hello from claude" }],
						},
					}),
					JSON.stringify({
						type: "result",
						subtype: "success",
						result: "hello from claude",
						usage: { input_tokens: 3, output_tokens: 2 },
					}),
				],
			}),
		);

		const { runClaudeAgent } = await import("../claude-run.js");
		const result = await runClaudeAgent({
			cwd: process.cwd(),
			prompt: "hi",
			apiKey: "test-key",
			bin: "claude",
		});

		expect(result.status).toBe("completed");
		expect(result.trace.messages.some((m) => m.content.includes("hello from claude"))).toBe(true);
		expect(result.trace.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 });
		expect(spawnMock).toHaveBeenCalled();
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("--bare");
		expect(args).toContain("stream-json");
	});

	it("fails fast on AskUserQuestion", async () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env[CLAUDE_AUTH_MODE_ENV] = "api-key";
		spawnMock.mockImplementation(() =>
			mockChild({
				lines: [
					JSON.stringify({
						type: "assistant",
						message: {
							role: "assistant",
							content: [
								{
									type: "tool_use",
									id: "toolu_q",
									name: "AskUserQuestion",
									input: { question: "pick one" },
								},
							],
						},
					}),
				],
			}),
		);

		const { runClaudeAgent } = await import("../claude-run.js");
		await expect(
			runClaudeAgent({
				cwd: process.cwd(),
				prompt: "hi",
				apiKey: "test-key",
				bin: "claude",
			}),
		).rejects.toBeInstanceOf(UserInputRequiredError);
	});

	it("times out and cancels the child via abort", async () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env[CLAUDE_AUTH_MODE_ENV] = "api-key";
		spawnMock.mockImplementation(() => mockChild({ hang: true }));

		const { runClaudeAgent } = await import("../claude-run.js");
		await expect(
			runClaudeAgent({
				cwd: process.cwd(),
				prompt: "hi",
				apiKey: "test-key",
				bin: "claude",
				timeoutMs: 40,
			}),
		).rejects.toBeInstanceOf(AgentRunTimeoutError);
		const child = spawnMock.mock.results[0]?.value as { kill: ReturnType<typeof vi.fn> };
		expect(child.kill).toHaveBeenCalled();
	});

	it("surfaces missing binary errors from spawn", async () => {
		process.env.ANTHROPIC_API_KEY = "test-key";
		process.env[CLAUDE_AUTH_MODE_ENV] = "api-key";
		spawnMock.mockImplementation(() => {
			const child = mockChild({ hang: true });
			queueMicrotask(() => {
				const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
				child.emit("error", err);
			});
			return child;
		});

		const { runClaudeAgent } = await import("../claude-run.js");
		await expect(
			runClaudeAgent({
				cwd: process.cwd(),
				prompt: "hi",
				apiKey: "test-key",
				bin: "nonexistent-claude-binary-xyz",
			}),
		).rejects.toThrow(/Claude Code binary not found/);
	});

	it("rejects an absolute CLAUDE_CODE_BIN that does not exist", async () => {
		const { resolveClaudeBin } = await import("../claude-run.js");
		await expect(resolveClaudeBin("/missing/claude-bin")).rejects.toThrow(
			/Claude Code binary not found at/,
		);
	});

	it("ClaudeAdapter returns failed session when key missing", async () => {
		const adapter = new ClaudeAdapter();
		const session = await adapter.run({
			host: "claude",
			cwd: process.cwd(),
			context: emptyContext(),
			prompt: "x",
		});
		expect(session.host).toBe("claude");
		expect(session.status).toBe("failed");
	});
});

describe("formatClaudeRunFailure", () => {
	it("includes cli status and exit code", async () => {
		const { formatClaudeRunFailure } = await import("../claude-run.js");
		expect(
			formatClaudeRunFailure({
				status: "failed",
				rawStatus: "error",
				exitCode: 1,
				resultError: "boom",
			}),
		).toContain("cli: error");
	});
});

describe("buildClaudeMcpConfigJson", () => {
	it("maps stdio and http servers", async () => {
		const { buildClaudeMcpConfigJson } = await import("../claude-run.js");
		expect(
			buildClaudeMcpConfigJson({
				echo: { command: "node", args: ["echo.js"], env: { A: "1" } },
				remote: { type: "http", url: "https://example.com/mcp" },
			}),
		).toEqual({
			mcpServers: {
				echo: { command: "node", args: ["echo.js"], env: { A: "1" } },
				remote: { type: "http", url: "https://example.com/mcp" },
			},
		});
	});
});

describe("cancelActiveClaudeRun", () => {
	it("is a no-op when no run is active", async () => {
		const { cancelActiveClaudeRun } = await import("../claude-run.js");
		expect(() => cancelActiveClaudeRun()).not.toThrow();
	});
});
