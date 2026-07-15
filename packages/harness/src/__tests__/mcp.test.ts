import { describe, expect, it } from "vitest";

import {
	expandEnvPlaceholders,
	mergeMcpServers,
	resolveMcpServers,
} from "../mcp.js";

const tokenPlaceholder = "${" + "TOKEN}";
const missingPlaceholder = "${" + "MISSING}";

describe("mcp helpers", () => {
	it("expands env placeholders", () => {
		expect(
			expandEnvPlaceholders(`Bearer ${tokenPlaceholder}`, { TOKEN: "secret" }),
		).toBe("Bearer secret");
	});

	it("throws when env placeholder is missing", () => {
		expect(() => expandEnvPlaceholders(missingPlaceholder, {})).toThrow(
			/MISSING/,
		);
	});

	it("merges suite defaults with scenario overrides by server name", () => {
		const merged = mergeMcpServers(
			{
				docs: { type: "http", url: "https://example.com/mcp" },
				echo: { type: "stdio", command: "node", args: ["old.mjs"] },
			},
			{
				echo: { type: "stdio", command: "node", args: ["new.mjs"] },
			},
		);
		expect(merged).toEqual({
			docs: { type: "http", url: "https://example.com/mcp" },
			echo: { type: "stdio", command: "node", args: ["new.mjs"] },
		});
	});

	it("resolves stdio cwd and expands env in headers", () => {
		const resolved = resolveMcpServers(
			{
				echo: {
					type: "stdio",
					command: "node",
					args: ["server.mjs"],
					cwd: "fixtures",
					env: { TOKEN: tokenPlaceholder },
				},
				docs: {
					type: "http",
					url: "https://example.com/mcp",
					headers: { Authorization: `Bearer ${tokenPlaceholder}` },
				},
			},
			{ cwd: "/repo", env: { TOKEN: "abc" } },
		);
		expect(resolved?.echo).toMatchObject({
			command: "node",
			cwd: "/repo/fixtures",
			env: { TOKEN: "abc" },
		});
		expect(resolved?.docs).toMatchObject({
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer abc" },
		});
	});
});
