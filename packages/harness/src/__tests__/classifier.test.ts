import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setProcessAuthMode } from "../auth-mode.js";
import { missingClassifierAuth } from "../classifier.js";
import { AGENT_HOSTS, isAgentHost } from "../types.js";

afterEach(() => {
	setProcessAuthMode(undefined);
});

describe("isAgentHost", () => {
	it("accepts cursor, claude, and openai", () => {
		expect([...AGENT_HOSTS]).toEqual(["cursor", "claude", "openai"]);
		expect(isAgentHost("openai")).toBe(true);
		expect(isAgentHost("replay")).toBe(false);
	});
});

describe("missingClassifierAuth", () => {
	it("names a missing Cursor SDK login under the subscription default", async () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		const priorHome = process.env.HOME;
		const home = await mkdtemp(join(tmpdir(), "classifier-no-sdk-login-"));
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_AUTH_MODE;
		process.env.HOME = home;
		try {
			expect(missingClassifierAuth("cursor")).toMatch(/agent-test login/);
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
			if (priorHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = priorHome;
			}
			await rm(home, { recursive: true, force: true });
		}
	});

	it("names the Cursor key when --auth-mode api-key has no key", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_AUTH_MODE;
		setProcessAuthMode("api-key");
		try {
			expect(missingClassifierAuth("cursor")).toMatch(/CURSOR_API_KEY/);
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

	it("accepts the OpenAI classifier under the subscription default", () => {
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		const priorMode = process.env.OPENAI_AUTH_MODE;
		delete process.env.OPENAI_API_KEY;
		delete process.env.CODEX_API_KEY;
		delete process.env.OPENAI_AUTH_MODE;
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
