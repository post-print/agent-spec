import { afterEach, expect, it, jest, mock } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { buildClaudeEnv, CLAUDE_AUTH_MODE_ENV, parseClaudeAuthMode } from "../claude-run.js";
import { AgentRunTimeoutError, UserInputRequiredError } from "../run-guards.js";

const INVALID_AUTH = /invalid/;
const CLAUDE_BINARY_MISSING = /Claude Code binary not found/;
const CLAUDE_PATH_MISSING = /Claude Code binary not found at/;

const spawnMock = jest.fn();

mock.module("node:child_process", () => ({
	...childProcess,
	spawn: spawnMock,
}));

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
	kill: ReturnType<typeof jest.fn>;
} {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		pid: number;
		kill: ReturnType<typeof jest.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	// Invalid pid so killClaudeChild skips process.kill(-pid) process-group signaling.
	Object.defineProperty(child, "pid", { value: undefined, configurable: true });
	child.kill = jest.fn(() => {
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

afterEach(() => {
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env[CLAUDE_AUTH_MODE_ENV];
	spawnMock.mockReset();
});

it("runClaudeAgent › defaults unset mode to subscription and rejects an unknown value", () => {
	expect(parseClaudeAuthMode(undefined)).toBe("subscription");
	expect(parseClaudeAuthMode("   ")).toBe("subscription");
	expect(() => parseClaudeAuthMode("subscription-ish")).toThrow(INVALID_AUTH);
	expect(parseClaudeAuthMode("api-key")).toBe("api-key");
	expect(parseClaudeAuthMode(" subscription ")).toBe("subscription");
});

it("runClaudeAgent › uses subscription when CLAUDE_AUTH_MODE is unset", async () => {
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	spawnMock.mockImplementation(() =>
		mockChild({
			lines: [
				JSON.stringify({
					type: "result",
					subtype: "success",
					result: "ok",
				}),
			],
		}),
	);
	const { runClaudeAgent } = await import("../claude-run.js");
	const result = await runClaudeAgent({
		cwd: process.cwd(),
		prompt: "hi",
		bin: "claude",
	});
	expect(result.status).toBe("completed");
	expect(spawnMock).toHaveBeenCalled();
	const args = spawnMock.mock.calls[0]?.[1] as string[];
	expect(args).toContain("--strict-mcp-config");
	expect(args).not.toContain("--bare");
});

it("runClaudeAgent › passes the key through in api-key mode", () => {
	const env = buildClaudeEnv("api-key", "sk-ant-test");
	expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
});

it("runClaudeAgent › strips a stale key in subscription mode", () => {
	// --bare never reads OAuth or the keychain, so a stale key left in the
	// parent shell would silently bill the API instead of the plan.
	const env = buildClaudeEnv("subscription", "sk-ant-stale");
	expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});

it("runClaudeAgent › maps a successful stream-json run", async () => {
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

it("runClaudeAgent › fails fast on AskUserQuestion", async () => {
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

it("runClaudeAgent › times out and cancels the child via abort", async () => {
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
	const child = spawnMock.mock.results[0]?.value as { kill: ReturnType<typeof jest.fn> };
	expect(child.kill).toHaveBeenCalled();
});

it("runClaudeAgent › surfaces missing binary errors from spawn", async () => {
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
	).rejects.toThrow(CLAUDE_BINARY_MISSING);
});

it("runClaudeAgent › rejects an absolute CLAUDE_CODE_BIN that does not exist", async () => {
	const { resolveClaudeBin } = await import("../claude-run.js");
	await expect(resolveClaudeBin("/missing/claude-bin")).rejects.toThrow(CLAUDE_PATH_MISSING);
});

it("runClaudeAgent › formatClaudeRunFailure › includes cli status and exit code", async () => {
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

it("runClaudeAgent › withMcpAllowedTools › appends Claude MCP prefixes for each server", async () => {
	const { withMcpAllowedTools } = await import("../claude-run.js");
	expect(
		withMcpAllowedTools("Bash,Read", {
			echo: { command: "node", args: ["echo.mjs"] },
		}),
	).toBe("Bash,Read,mcp__echo,mcp__echo__*");
});

it("runClaudeAgent › withMcpAllowedTools › leaves the list unchanged when no servers are set", async () => {
	const { withMcpAllowedTools } = await import("../claude-run.js");
	expect(withMcpAllowedTools("Bash,Read", undefined)).toBe("Bash,Read");
});

it("runClaudeAgent › buildClaudeMcpConfigJson › maps stdio and http servers", async () => {
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

it("runClaudeAgent › cancelActiveClaudeRun › is a no-op when no run is active", async () => {
	const { cancelActiveClaudeRun } = await import("../claude-run.js");
	expect(() => cancelActiveClaudeRun()).not.toThrow();
});

it("runClaudeAgent keeps MCP configuration until the child settles", async () => {
	let configPath = "";
	let configDuringRun = "";
	spawnMock.mockImplementation((_bin: string, args: string[]) => {
		configPath = args[args.indexOf("--mcp-config") + 1] ?? "";
		const child = mockChild({ hang: true });
		setTimeout(async () => {
			try {
				configDuringRun = await Bun.file(configPath).text();
			} catch {
				configDuringRun = "missing";
			}
			child.stdout.end();
			child.stderr.end();
			child.emit("close", 0);
		}, 10);
		return child;
	});
	const { runClaudeAgent } = await import("../claude-run.js");
	await runClaudeAgent({
		cwd: process.cwd(),
		prompt: "Read the record.",
		mcpServers: { records: { command: "node", args: ["records.mjs"] } },
	});
	expect(configDuringRun).toContain("records.mjs");
	expect(await Bun.file(configPath).exists()).toBe(false);
});
