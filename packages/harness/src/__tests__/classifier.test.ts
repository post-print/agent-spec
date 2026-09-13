import { describe, expect, it } from "bun:test";

import { missingClassifierAuth } from "../classifier.js";
import { AGENT_HOSTS, isAgentHost } from "../types.js";

describe("isAgentHost", () => {
	it("accepts cursor, claude, and openai", () => {
		expect([...AGENT_HOSTS]).toEqual(["cursor", "claude", "openai"]);
		expect(isAgentHost("openai")).toBe(true);
		expect(isAgentHost("replay")).toBe(false);
	});
});

describe("missingClassifierAuth", () => {
	it("names the Cursor key when the Cursor classifier has no key", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_AUTH_MODE;
		try {
			expect(missingClassifierAuth("cursor")).toMatch(/CURSOR_API_KEY/);
			expect(missingClassifierAuth("cursor", "injected")).toBeUndefined();
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
			if (priorMode === undefined) {
				delete process.env.CURSOR_AUTH_MODE;
			} else {
				process.env.CURSOR_AUTH_MODE = priorMode;
			}
		}
	});

	it("accepts a Cursor SDK login when CURSOR_AUTH_MODE=subscription", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		process.env.CURSOR_AUTH_MODE = "subscription";
		try {
			expect(missingClassifierAuth("cursor")).toBeUndefined();
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
			if (priorMode === undefined) {
				delete process.env.CURSOR_AUTH_MODE;
			} else {
				process.env.CURSOR_AUTH_MODE = priorMode;
			}
		}
	});

	it("does not demand CURSOR_API_KEY for OpenAI", () => {
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		const priorMode = process.env.OPENAI_AUTH_MODE;
		delete process.env.OPENAI_API_KEY;
		delete process.env.CODEX_API_KEY;
		delete process.env.OPENAI_AUTH_MODE;
		try {
			expect(missingClassifierAuth("openai")).toMatch(/OPENAI_API_KEY or CODEX_API_KEY/);
		} finally {
			if (priorOpen === undefined) {
				delete process.env.OPENAI_API_KEY;
			} else {
				process.env.OPENAI_API_KEY = priorOpen;
			}
			if (priorCodex === undefined) {
				delete process.env.CODEX_API_KEY;
			} else {
				process.env.CODEX_API_KEY = priorCodex;
			}
			if (priorMode === undefined) {
				delete process.env.OPENAI_AUTH_MODE;
			} else {
				process.env.OPENAI_AUTH_MODE = priorMode;
			}
		}
	});

	it("accepts a Codex CLI login when OPENAI_AUTH_MODE=subscription", () => {
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		const priorMode = process.env.OPENAI_AUTH_MODE;
		delete process.env.OPENAI_API_KEY;
		delete process.env.CODEX_API_KEY;
		process.env.OPENAI_AUTH_MODE = "subscription";
		try {
			expect(missingClassifierAuth("openai")).toBeUndefined();
		} finally {
			if (priorOpen === undefined) {
				delete process.env.OPENAI_API_KEY;
			} else {
				process.env.OPENAI_API_KEY = priorOpen;
			}
			if (priorCodex === undefined) {
				delete process.env.CODEX_API_KEY;
			} else {
				process.env.CODEX_API_KEY = priorCodex;
			}
			if (priorMode === undefined) {
				delete process.env.OPENAI_AUTH_MODE;
			} else {
				process.env.OPENAI_AUTH_MODE = priorMode;
			}
		}
	});
});
