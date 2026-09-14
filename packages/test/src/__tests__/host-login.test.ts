import { describe, expect, it } from "bun:test";

import { CURSOR_SDK_LOGIN_HINT } from "@post-print/agent-harness";

import {
	ensureCursorSdkLoginForLive,
	offerCursorSdkReloginIfNeeded,
	reportsNeedCursorRelogin,
	runHostLogin,
} from "../host-login.js";
import type { SuiteRunReport } from "../types.js";

function emptyReport(message: string): SuiteRunReport {
	return {
		suite: "smoke",
		host: "cursor",
		passed: 0,
		failed: 1,
		skipped: 0,
		results: [
			{
				suite: "smoke",
				scenario: "hello",
				passed: false,
				failures: [{ matcher: "runAgent", message, category: "agent_runtime" }],
				durationMs: 1,
			},
		],
	};
}

describe("runHostLogin", () => {
	it("logs Cursor in through the SDK and does not print the key", async () => {
		const lines: string[] = [];
		const code = await runHostLogin("cursor", {
			log: (line) => {
				lines.push(line);
			},
			loginCursor: async ({ onLoginUrl }) => {
				onLoginUrl?.("https://cursor.com/login#test");
				return { email: "dev@example.com", apiKeyExpiresAtMs: 1 };
			},
		});
		expect(code).toBe(0);
		expect(lines.join("\n")).toContain("https://cursor.com/login#test");
		expect(lines.join("\n")).toContain("Logged in as dev@example.com.");
		expect(lines.join("\n")).not.toMatch(/sk-|apiKey|secret/i);
	});

	it("does not invent a Claude key store", async () => {
		const lines: string[] = [];
		const code = await runHostLogin("claude", {
			log: (line) => {
				lines.push(line);
			},
		});
		expect(code).toBe(1);
		expect(lines.join("\n")).toMatch(/Claude Code CLI login/);
	});

	it("starts Codex CLI login", async () => {
		const spawned: string[][] = [];
		const code = await runHostLogin("openai", {
			log: () => {},
			spawn: async (command, args) => {
				spawned.push([command, ...args]);
				return 0;
			},
		});
		expect(code).toBe(0);
		expect(spawned[0]?.slice(-1)).toEqual(["login"]);
	});
});

describe("ensureCursorSdkLoginForLive", () => {
	it("opens Cursor login on a TTY subscription run when the store is empty", async () => {
		let called = 0;
		await ensureCursorSdkLoginForLive({
			hosts: ["cursor"],
			authMode: "subscription",
			tty: true,
			hasLoginFile: () => false,
			log: () => {},
			loginCursor: async () => {
				called += 1;
				return {};
			},
		});
		expect(called).toBe(1);
	});

	it("skips login when the store is present or the run is not a TTY", async () => {
		let called = 0;
		const login = async () => {
			called += 1;
			return {};
		};
		await ensureCursorSdkLoginForLive({
			hosts: ["cursor"],
			authMode: "subscription",
			tty: true,
			hasLoginFile: () => true,
			loginCursor: login,
		});
		await ensureCursorSdkLoginForLive({
			hosts: ["cursor"],
			authMode: "subscription",
			tty: false,
			hasLoginFile: () => false,
			loginCursor: login,
		});
		await ensureCursorSdkLoginForLive({
			hosts: ["cursor"],
			authMode: "api-key",
			tty: true,
			hasLoginFile: () => false,
			loginCursor: login,
		});
		expect(called).toBe(0);
	});
});

describe("offerCursorSdkReloginIfNeeded", () => {
	it("detects Invalid User API Key failures", () => {
		expect(reportsNeedCursorRelogin([emptyReport("Invalid User API Key")])).toBe(true);
		expect(reportsNeedCursorRelogin([emptyReport("suite failed")])).toBe(false);
	});

	it("offers login on a TTY after an invalid key", async () => {
		let loggedIn = 0;
		const offered = await offerCursorSdkReloginIfNeeded({
			reports: [emptyReport("Invalid User API Key")],
			tty: true,
			log: () => {},
			confirm: async () => true,
			loginCursor: async () => {
				loggedIn += 1;
				return {};
			},
		});
		expect(offered).toBe(true);
		expect(loggedIn).toBe(1);
	});

	it("prints the hint without login when the session is not a TTY", async () => {
		const lines: string[] = [];
		const offered = await offerCursorSdkReloginIfNeeded({
			reports: [emptyReport("Invalid User API Key")],
			tty: false,
			log: (line) => {
				lines.push(line);
			},
			loginCursor: async () => {
				throw new Error("must not login");
			},
		});
		expect(offered).toBe(false);
		expect(lines.join("\n")).toContain(CURSOR_SDK_LOGIN_HINT);
	});
});
