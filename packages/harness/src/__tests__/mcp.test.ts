import { expect, it } from "bun:test";

import { expandEnvPlaceholders, mergeMcpServers, resolveMcpServers } from "../mcp.js";

const MISSING_ENV = /MISSING/;

const tokenPlaceholder = `\${TOKEN}`;
const missingPlaceholder = `\${MISSING}`;

it("mcp helpers › expands env placeholders", () => {
	expect(expandEnvPlaceholders(`Bearer ${tokenPlaceholder}`, { TOKEN: "secret" })).toBe(
		"Bearer secret",
	);
});

it("mcp helpers › throws when env placeholder is missing", () => {
	expect(() => expandEnvPlaceholders(missingPlaceholder, {})).toThrow(MISSING_ENV);
});

it("mcp helpers › merges suite defaults with scenario overrides by server name", () => {
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

it("mcp helpers › resolves stdio cwd and expands env in headers", () => {
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

it("mcp helpers › strips display-only tool metadata before host configuration", () => {
	expect(
		resolveMcpServers(
			{
				tasks: {
					type: "stdio",
					tools: ["search_tasks", "get_task"],
					command: "node",
				},
			},
			{ cwd: "/tmp/workspace" },
		),
	).toEqual({
		tasks: { type: "stdio", command: "node", cwd: "/tmp/workspace" },
	});
});
