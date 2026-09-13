import { describe, expect, it } from "bun:test";

import { parseOptionalAuthMode, resolveKeyOrLoginAuthMode } from "../auth-mode.js";
import {
	CURSOR_AUTH_MODE_ENV,
	CURSOR_MISSING_KEY_MESSAGE,
	resolveCursorAuthMode,
	withCursorAuthEnv,
} from "../cursor-run.js";
import {
	buildOpenaiEnv,
	OPENAI_AUTH_MODE_ENV,
	OPENAI_MISSING_KEY_MESSAGE,
	resolveOpenaiAuthMode,
} from "../openai-run.js";

describe("parseOptionalAuthMode", () => {
	it("returns undefined when unset", () => {
		expect(parseOptionalAuthMode("CURSOR_AUTH_MODE", undefined)).toBeUndefined();
		expect(parseOptionalAuthMode("CURSOR_AUTH_MODE", "   ")).toBeUndefined();
	});

	it("accepts api-key and subscription", () => {
		expect(parseOptionalAuthMode("CURSOR_AUTH_MODE", "api-key")).toBe("api-key");
		expect(parseOptionalAuthMode("CURSOR_AUTH_MODE", " subscription ")).toBe("subscription");
	});

	it("rejects an unknown value", () => {
		expect(() => parseOptionalAuthMode("CURSOR_AUTH_MODE", "login")).toThrow(/invalid/);
	});
});

describe("resolveKeyOrLoginAuthMode", () => {
	it("uses a present key when the mode is unset", () => {
		expect(
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: undefined,
				hasApiKey: true,
				missingKeyMessage: "missing",
			}),
		).toBe("api-key");
	});

	it("honors an explicit subscription mode when a key is also set", () => {
		expect(
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: "subscription",
				hasApiKey: true,
				missingKeyMessage: "missing",
			}),
		).toBe("subscription");
	});

	it("names the key and the login mode when both are unset", () => {
		expect(() =>
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: undefined,
				hasApiKey: false,
				missingKeyMessage: CURSOR_MISSING_KEY_MESSAGE,
			}),
		).toThrow(/CURSOR_AUTH_MODE=subscription/);
	});
});

describe("resolveCursorAuthMode", () => {
	it("defaults to api-key when CURSOR_API_KEY is set", () => {
		const priorMode = process.env[CURSOR_AUTH_MODE_ENV];
		const priorKey = process.env.CURSOR_API_KEY;
		delete process.env[CURSOR_AUTH_MODE_ENV];
		process.env.CURSOR_API_KEY = "cursor-test-key";
		try {
			expect(resolveCursorAuthMode()).toBe("api-key");
		} finally {
			if (priorMode === undefined) {
				delete process.env[CURSOR_AUTH_MODE_ENV];
			} else {
				process.env[CURSOR_AUTH_MODE_ENV] = priorMode;
			}
			if (priorKey === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = priorKey;
			}
		}
	});
});

describe("withCursorAuthEnv", () => {
	it("strips a stale key for the duration of a subscription run", async () => {
		const prior = process.env.CURSOR_API_KEY;
		process.env.CURSOR_API_KEY = "stale-key";
		try {
			await withCursorAuthEnv("subscription", () => {
				expect(process.env.CURSOR_API_KEY).toBeUndefined();
			});
			expect(process.env.CURSOR_API_KEY).toBe("stale-key");
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
		}
	});
});

describe("resolveOpenaiAuthMode", () => {
	it("keeps api-key when a Codex key is set", () => {
		const priorMode = process.env[OPENAI_AUTH_MODE_ENV];
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		delete process.env[OPENAI_AUTH_MODE_ENV];
		delete process.env.OPENAI_API_KEY;
		process.env.CODEX_API_KEY = "codex-test-key";
		try {
			expect(resolveOpenaiAuthMode()).toBe("api-key");
		} finally {
			if (priorMode === undefined) {
				delete process.env[OPENAI_AUTH_MODE_ENV];
			} else {
				process.env[OPENAI_AUTH_MODE_ENV] = priorMode;
			}
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
		}
	});

	it("names the login mode when no key is set", () => {
		expect(() => resolveOpenaiAuthMode(undefined, "")).toThrow(OPENAI_MISSING_KEY_MESSAGE);
	});
});

describe("buildOpenaiEnv", () => {
	it("strips a stale key in subscription mode", () => {
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		process.env.OPENAI_API_KEY = "stale-open";
		process.env.CODEX_API_KEY = "stale-codex";
		try {
			const env = buildOpenaiEnv("subscription", "stale-open");
			expect(env.OPENAI_API_KEY).toBeUndefined();
			expect(env.CODEX_API_KEY).toBeUndefined();
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
		}
	});

	it("passes the key through in api-key mode", () => {
		const env = buildOpenaiEnv("api-key", "sk-test");
		expect(env.OPENAI_API_KEY).toBe("sk-test");
		expect(env.CODEX_API_KEY).toBe("sk-test");
	});
});
