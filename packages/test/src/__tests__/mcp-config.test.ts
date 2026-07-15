import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadSuiteFile } from "../load-suite.js";
import { isMcpServerConfig, isMcpServersMap } from "../mcp-config.js";

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
});
