import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandViewerJobs, loadViewerCatalog } from "../viewer/catalog.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("loadViewerCatalog", () => {
	it("lists fixture suites with prompt, rubric, and default cursor host", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
		});

		expect(catalog.defaultSelectedHosts).toEqual(["cursor"]);
		expect(catalog.suitesDir).toBe(join(repoRoot, "packages/test/fixtures"));

		const smoke = catalog.suites.find((suite) => suite.name === "smoke");
		expect(smoke).toBeDefined();
		expect(smoke?.description).toBe("Minimal direct-agent suite for loader and validation checks");
		expect(smoke?.hosts).toEqual(["cursor"]);
		expect(smoke?.scenarios.map((scenario) => scenario.name)).toEqual([
			"hello direct",
			"mcp echo tool",
		]);

		const hello = smoke?.scenarios.find((scenario) => scenario.name === "hello direct");
		expect(hello?.prompt).toBe("Say hello and confirm the smoke suite ran.");
		expect(hello?.rubric).toEqual({ must: ["smoke suite ok"] });
		expect(hello?.compare).toBeUndefined();
		expect(hello).not.toHaveProperty("mcpServers");

		const mcp = smoke?.scenarios.find((scenario) => scenario.name === "mcp echo tool");
		expect(mcp?.prompt).toBe('Call the echo MCP tool with text "mcp echo ok".');
		expect(mcp).not.toHaveProperty("mcpServers");
	});

	it("lists the confidence suite and tour compare arms", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});

		const confidence = catalog.suites.find((suite) => suite.name === "confidence");
		expect(confidence?.hosts).toEqual(["cursor", "claude", "openai"]);
		expect(confidence?.scenarios).toHaveLength(6);

		const tour = catalog.suites.find((suite) => suite.name === "tour");
		const compare = tour?.scenarios.find(
			(scenario) => scenario.name === "compares three MCP workflows",
		);
		expect(compare?.description).toBe(
			"The scenario measures an old summary, a search path, and a direct detail path.",
		);
		expect(compare?.compare?.map((arm) => arm.id)).toEqual([
			"summary-only",
			"search-detail",
			"direct-detail",
		]);
		expect(compare?.gates).toHaveLength(4);
	});

	it("expands a compare scenario onto one job per host and arm", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});
		const jobs = expandViewerJobs(catalog, {
			suite: "tour",
			scenario: "measures the value of a helpful tool",
			hosts: ["cursor", "claude"],
		});
		const prompt =
			"Find the current due date for TASK-104. Use the fastest authoritative source. If no task index tool exists, read records/TASK-101.md, records/TASK-102.md, records/TASK-103.md, and records/TASK-104.md separately. Do not use a wildcard. Reply with the date in YYYY-MM-DD format only.";
		expect(jobs).toEqual([
			{
				suite: "tour",
				scenario: "measures the value of a helpful tool",
				host: "cursor",
				arm: "a",
				prompt,
			},
			{
				suite: "tour",
				scenario: "measures the value of a helpful tool",
				host: "cursor",
				arm: "b",
				prompt,
			},
			{
				suite: "tour",
				scenario: "measures the value of a helpful tool",
				host: "claude",
				arm: "a",
				prompt,
			},
			{
				suite: "tour",
				scenario: "measures the value of a helpful tool",
				host: "claude",
				arm: "b",
				prompt,
			},
		]);
	});
});
