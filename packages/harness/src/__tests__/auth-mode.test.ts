import { afterEach, describe, expect, it } from "bun:test";

import {
	DEFAULT_HOST_AUTH_MODE,
	parseHostAuthModeFlag,
	parseOptionalAuthMode,
	resolveHostAuthMode,
	resolveKeyOrLoginAuthMode,
	setProcessAuthMode,
} from "../auth-mode.js";
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

afterEach(() => {
	setProcessAuthMode(undefined);
});

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

describe("parseHostAuthModeFlag", () => {
	it("accepts subscription and api-key", () => {
		expect(parseHostAuthModeFlag("subscription")).toBe("subscription");
		expect(parseHostAuthModeFlag(" api-key ")).toBe("api-key");
	});

	it("rejects an unknown value", () => {
		expect(() => parseHostAuthModeFlag("subscriber", "--auth-mode")).toThrow(/--auth-mode must be/);
	});
});

describe("resolveHostAuthMode", () => {
	it("defaults to subscription", () => {
		expect(DEFAULT_HOST_AUTH_MODE).toBe("subscription");
		expect(
			resolveHostAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: undefined,
			}),
		).toBe("subscription");
	});

	it("prefers an explicit option over env and process", () => {
		setProcessAuthMode("api-key");
		expect(
			resolveHostAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: "api-key",
				explicit: "subscription",
			}),
		).toBe("subscription");
	});

	it("prefers process --auth-mode over env", () => {
		setProcessAuthMode("api-key");
		expect(
			resolveHostAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: "subscription",
			}),
		).toBe("api-key");
	});
});

describe("resolveKeyOrLoginAuthMode", () => {
	it("defaults to subscription when a key is present", () => {
		expect(
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: undefined,
				hasApiKey: true,
				missingKeyMessage: "missing",
			}),
		).toBe("subscription");
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

	it("defaults to subscription when both mode and key are unset", () => {
		expect(
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: undefined,
				hasApiKey: false,
				missingKeyMessage: CURSOR_MISSING_KEY_MESSAGE,
			}),
		).toBe("subscription");
	});

	it("names the key when api-key mode has no key", () => {
		expect(() =>
			resolveKeyOrLoginAuthMode({
				envName: "CURSOR_AUTH_MODE",
				raw: "api-key",
				hasApiKey: false,
				missingKeyMessage: CURSOR_MISSING_KEY_MESSAGE,
			}),
		).toThrow(/CURSOR_API_KEY required for --auth-mode api-key/);
	});
});

describe("resolveCursorAuthMode", () => {
	it("defaults to subscription when CURSOR_API_KEY is set", () => {
		const priorMode = process.env[CURSOR_AUTH_MODE_ENV];
		const priorKey = process.env.CURSOR_API_KEY;
		delete process.env[CURSOR_AUTH_MODE_ENV];
		process.env.CURSOR_API_KEY = "cursor-test-key";
		try {
			expect(resolveCursorAuthMode()).toBe("subscription");
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
	it("defaults to subscription when a Codex key is set", () => {
		const priorMode = process.env[OPENAI_AUTH_MODE_ENV];
		const priorOpen = process.env.OPENAI_API_KEY;
		const priorCodex = process.env.CODEX_API_KEY;
		delete process.env[OPENAI_AUTH_MODE_ENV];
		delete process.env.OPENAI_API_KEY;
		process.env.CODEX_API_KEY = "codex-test-key";
		try {
			expect(resolveOpenaiAuthMode()).toBe("subscription");
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

	it("names the key when api-key mode has no key", () => {
		expect(() => resolveOpenaiAuthMode("api-key", "")).toThrow(OPENAI_MISSING_KEY_MESSAGE);
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
