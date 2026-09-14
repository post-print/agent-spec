import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

import { loadSuiteFile } from "../load-suite.js";
import { bindMcpServersToCaller, isMcpServerConfig, isMcpServersMap } from "../mcp-config.js";

describe("mcp-config validation", () => {
	it("accepts stdio and http server configs", () => {
		expect(
			isMcpServersMap({
				echo: { type: "stdio", command: "node", args: ["server.mjs"] },
				docs: {
					type: "http",
					url: "https://example.com/mcp",
					headers: { Authorization: "Bearer $" + "{TOKEN}" },
				},
			}),
		).toBe(true);
	});

	it("rejects server configs without command or url", () => {
		expect(isMcpServerConfig({ type: "stdio" })).toBe(false);
		expect(isMcpServersMap({ bad: { type: "http" } })).toBe(false);
	});

	it("loads smoke suite with mcpServers scenario", async () => {
		const suitePath = fileURLToPath(
			new URL("../../fixtures/smoke/scenarios.json", import.meta.url),
		);
		const suite = await loadSuiteFile(suitePath);
		const mcpScenario = suite.scenarios.find((s) => s.name === "mcp echo tool");
		expect(mcpScenario?.mcpServers?.echo).toMatchObject({
			type: "stdio",
			command: "node",
		});
		expect(mcpScenario?.rubric.mustCallTool).toContain("echo:mcp echo ok");
	});

	it("loads a live tour MCP scenario", async () => {
		const suitePath = fileURLToPath(
			new URL("../../../../agent-suites/tour/scenarios.json", import.meta.url),
		);
		const suite = await loadSuiteFile(suitePath);
		const scenario = suite.scenarios.find((item) => item.name === "uses the issue service");
		expect(scenario?.mcpServers?.tasks).toMatchObject({
			type: "stdio",
			command: "node",
		});
		expect(scenario?.rubric.mustCallTool).toContain("get_task:TASK-104");
		expect(suite.defaults?.workspace).toBe("agent-suites/fixtures/task-list");
	});
});

describe("bindMcpServersToCaller", () => {
	it("pins stdio cwd to the caller repo", () => {
		const bound = bindMcpServersToCaller(
			{
				echo: {
					type: "stdio",
					command: "node",
					args: ["packages/test/fixtures/mcp-echo/server.mjs"],
				},
			},
			"/repo",
		);
		expect(bound?.echo).toMatchObject({
			command: "node",
			cwd: "/repo",
		});
	});

	it("keeps an absolute stdio cwd", () => {
		const bound = bindMcpServersToCaller(
			{
				echo: { type: "stdio", command: "node", cwd: "/other" },
			},
			"/repo",
		);
		expect(bound?.echo).toMatchObject({ cwd: "/other" });
	});

	it("joins a relative stdio cwd to the caller repo", () => {
		const bound = bindMcpServersToCaller(
			{
				echo: { type: "stdio", command: "node", cwd: "packages/test" },
			},
			"/repo",
		);
		expect(bound?.echo).toMatchObject({ cwd: "/repo/packages/test" });
	});

	it("leaves HTTP servers unchanged", () => {
		const docs = { type: "http" as const, url: "https://example.com/mcp" };
		const bound = bindMcpServersToCaller({ docs }, "/repo");
		expect(bound?.docs).toEqual(docs);
	});

	it("returns undefined when no servers are set", () => {
		expect(bindMcpServersToCaller(undefined, "/repo")).toBeUndefined();
	});
});
