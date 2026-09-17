import { describe, expect, it } from "bun:test";
import { runHostLogin } from "../host-login.js";

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
