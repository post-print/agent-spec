import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	CURSOR_SDK_LOGIN_HINT,
	cursorSdkAuthFilePath,
	hasCursorSdkAuthFile,
	isInvalidCursorUserApiKey,
	loginCursorSdk,
	readCursorSdkAuthStatus,
	wrapCursorSdkAuthError,
} from "../cursor-auth.js";

describe("cursor SDK login store", () => {
	it("treats a missing or empty file as logged out", async () => {
		const home = await mkdtemp(join(tmpdir(), "cursor-auth-missing-"));
		try {
			expect(hasCursorSdkAuthFile(home)).toBe(false);
			await mkdir(join(home, ".cursor/sdk"), { recursive: true });
			await writeFile(cursorSdkAuthFilePath(home), "", "utf8");
			expect(hasCursorSdkAuthFile(home)).toBe(false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("detects a present login file without reading the key", async () => {
		const home = await mkdtemp(join(tmpdir(), "cursor-auth-present-"));
		try {
			await mkdir(join(home, ".cursor/sdk"), { recursive: true });
			await writeFile(cursorSdkAuthFilePath(home), '{"apiKey":"secret-do-not-print"}\n', "utf8");
			expect(hasCursorSdkAuthFile(home)).toBe(true);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});

describe("isInvalidCursorUserApiKey", () => {
	it("matches the SDK invalid-user-key message", () => {
		expect(isInvalidCursorUserApiKey("Invalid User API Key")).toBe(true);
		expect(isInvalidCursorUserApiKey(new Error("Invalid User API Key"))).toBe(true);
		expect(isInvalidCursorUserApiKey({ message: "Invalid User API Key" })).toBe(true);
		expect(isInvalidCursorUserApiKey("rate limited")).toBe(false);
	});
});

describe("wrapCursorSdkAuthError", () => {
	it("adds the login hint once", () => {
		const wrapped = wrapCursorSdkAuthError(new Error("Invalid User API Key"));
		expect(wrapped).toBeInstanceOf(Error);
		expect((wrapped as Error).message).toContain("Invalid User API Key");
		expect((wrapped as Error).message).toContain(CURSOR_SDK_LOGIN_HINT);
		const again = wrapCursorSdkAuthError(wrapped);
		expect((again as Error).message).toBe((wrapped as Error).message);
	});
});

describe("loginCursorSdk", () => {
	it("stores the login through the SDK and does not return the key", async () => {
		const urls: string[] = [];
		const result = await loginCursorSdk({
			auth: {
				async login(options) {
					options?.onLoginUrl?.("https://cursor.com/login#agent-test");
					return {
						apiKey: "secret-minted-key",
						email: "dev@example.com",
						apiKeyExpiresAtMs: 1,
					};
				},
				async status() {
					return { status: "logged-in", email: "dev@example.com" };
				},
			},
			onLoginUrl: (url) => {
				urls.push(url);
			},
		});
		expect(result).toEqual({ email: "dev@example.com", apiKeyExpiresAtMs: 1 });
		expect(result).not.toHaveProperty("apiKey");
		expect(urls).toEqual(["https://cursor.com/login#agent-test"]);
	});

	it("reads logged-in status without a key", async () => {
		const status = await readCursorSdkAuthStatus({
			auth: {
				async login() {
					return { apiKey: "secret", apiKeyExpiresAtMs: 1 };
				},
				async status() {
					return { status: "logged-in", email: "dev@example.com" };
				},
			},
		});
		expect(status).toEqual({ status: "logged-in", email: "dev@example.com" });
		expect(status).not.toHaveProperty("apiKey");
	});
});
