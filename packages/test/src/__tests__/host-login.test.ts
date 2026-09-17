import { expect, it } from "bun:test";
import { runHostLogin } from "../host-login.js";

const SECRET_MARKER = /sk-|apiKey|secret/i;
const CLAUDE_LOGIN = /Claude Code CLI login/;

it("runHostLogin › logs Cursor in through the SDK and does not print the key", async () => {
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
	expect(lines.join("\n")).not.toMatch(SECRET_MARKER);
});

it("runHostLogin › does not invent a Claude key store", async () => {
	const lines: string[] = [];
	const code = await runHostLogin("claude", {
		log: (line) => {
			lines.push(line);
		},
	});
	expect(code).toBe(1);
	expect(lines.join("\n")).toMatch(CLAUDE_LOGIN);
});

it("runHostLogin › starts Codex CLI login", async () => {
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
