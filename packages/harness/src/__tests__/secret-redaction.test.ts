import { describe, expect, it } from "bun:test";

import { isSecretFieldName, redactSecrets } from "../../dist/index.js";

/** Fake values are assembled at runtime so no literal looks like a credential in the repository. */
const fake = (...parts: string[]) => parts.join("");
const FILLER = "abcdefghijklmnopqrstuvwxyz0123456789";

describe("redactSecrets", () => {
	const leaks: Array<[string, string, string]> = [
		["JSON apiKey", `{"apiKey":"${FILLER}"}`, FILLER],
		["JSON spaced token", `{"token": "${FILLER}"}`, FILLER],
		["escaped JSON", `{\\"api_key\\":\\"${FILLER}\\"}`, FILLER],
		["single-quoted field", `{'password': '${FILLER}'}`, FILLER],
		["ghp token", `cloned with ${fake("gh", "p_", FILLER)}`, fake("gh", "p_")],
		["gho token", `auth ${fake("gh", "o_", FILLER)}`, fake("gh", "o_")],
		["github_pat token", `auth ${fake("github", "_pat_", FILLER, "_", FILLER)}`, FILLER],
		["AWS key id", `id ${fake("AK", "IA", "ABCDEFGHIJKLMNOP")}`, "ABCDEFGHIJKLMNOP"],
		["Slack token", `posted ${fake("xo", "xb-", "1234-", FILLER)}`, FILLER],
		["Authorization Basic", `Authorization: Basic ${FILLER}`, FILLER],
		["URL userinfo", `https://user:${FILLER}@github.com/x.git`, FILLER],
		["multi-word password", `password: correct ${FILLER} battery`, FILLER],
		["env assignment", `MY_API_KEY=${FILLER}`, FILLER],
		["bare key assignment", `key=${FILLER}`, FILLER],
	];
	for (const [name, text, secret] of leaks) {
		it(`removes ${name}`, () => {
			expect(redactSecrets(text)).not.toContain(secret);
		});
	}
	it("keeps JSON parseable and its key names", () => {
		const redacted = JSON.parse(redactSecrets(`{"apiKey": "${FILLER}", "model": "m"}`));
		expect(redacted).toEqual({ apiKey: "[redacted]", model: "m" });
	});
	const preserved = [
		'"totalTokens": 512',
		"max_tokens=100",
		"tokens: 1234",
		'"hasToken": true',
		"sort key: name",
		"keyboard: dvorak",
		"ssh://git@github.com/x.git",
		"Basic authentication is required",
	];
	for (const text of preserved) {
		it(`leaves ${text} alone`, () => {
			expect(redactSecrets(text)).toBe(text);
		});
	}
	it("stays fast on a long run of hyphenated text", () => {
		const started = performance.now();
		redactSecrets("a-".repeat(500_000));
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("isSecretFieldName", () => {
	for (const name of ["apiKey", "api_key", "x-api-key", "accessToken", "password", "authorization"])
		it(`${name} is secret`, () => expect(isSecretFieldName(name)).toBe(true));
	for (const name of ["key", "inputTokens", "tokens", "tokenizer", "keyboard", "model"])
		it(`${name} is not`, () => expect(isSecretFieldName(name)).toBe(false));
});
