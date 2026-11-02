import { describe, expect, it } from "bun:test";

import { storedValue, withoutSecrets } from "../sdk/stored-value.js";

const fakeSecret = () => ["abcdefgh", "ijklmnop", "qrstuvwx", "yz012345"].join("");

it("stored values redact secrets inside strings", () => {
	const secret = fakeSecret();
	const github = ["gh", "p_", secret, secret].join("");
	const stored = JSON.stringify(
		storedValue({
			output: `{"apiKey": "${secret}"}`,
			command: `git clone https://x:${github}@example.test/r.git`,
			note: `pushed with ${github}`,
		}),
	);
	expect(stored).not.toContain(secret);
	expect(stored).toContain("apiKey");
});

it("stored values redact string fields named like secrets, at any depth", () => {
	const secret = fakeSecret();
	expect(storedValue({ args: { apiKey: secret, nested: [{ access_token: secret }] } })).toEqual({
		args: { apiKey: "[redacted]", nested: [{ access_token: "[redacted]" }] },
	});
});

it("stored values keep token counts, ordinary keys and images intact", () => {
	const value = {
		usage: { inputTokens: 3, totalTokens: 5 },
		key: "sort-order",
		image: { mediaType: "image/png", bytes: 4, data: `sk-${fakeSecret()}` },
	};
	expect(storedValue(value)).toEqual(value);
});

describe("artifacts kept on this machine", () => {
	const secret = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
	it("lose secrets but keep local paths", () => {
		const kept = withoutSecrets({ root: "/tmp/work", output: `used ${secret}` });
		expect(JSON.stringify(kept)).not.toContain(secret);
		expect(kept).toMatchObject({ root: "/tmp/work" });
	});
});
