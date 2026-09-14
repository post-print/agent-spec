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

	it("lists in-repo smoke hosts and judge compare arms", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});

		const smoke = catalog.suites.find((suite) => suite.name === "smoke");
		expect(smoke?.hosts).toEqual(["cursor", "claude", "openai"]);
		expect(smoke?.scenarios[0]?.name).toBe("hello");
		expect(smoke?.scenarios[0]?.prompt).toBe(
			"Reply with the exact sentence: smoke ok. Do not use tools.",
		);

		const judge = catalog.suites.find((suite) => suite.name === "judge");
		const compare = judge?.scenarios.find(
			(scenario) => scenario.name === "compares two workspace arms",
		);
		expect(compare?.description).toBe(
			"Checks that two sealed workspaces reply with different one-word tokens.",
		);
		expect(compare?.compare).toEqual([
			{
				id: "a",
				label: "alpha",
				description: "Reads word.txt from the alpha workspace.",
			},
			{
				id: "b",
				label: "beta",
				description: "Reads word.txt from the beta workspace.",
			},
		]);

		const skill = judge?.scenarios.find(
			(scenario) => scenario.name === "skill arm is cheaper and more faithful",
		);
		expect(skill?.compare?.[1]).toEqual({
			id: "b",
			label: "with skill",
			description: "Uses the brief-ship skill. The agent must stay on the note.",
		});
	});

	it("expands a compare scenario onto one job per host and arm", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});
		const jobs = expandViewerJobs(catalog, {
			suite: "judge",
			scenario: "compares two workspace arms",
			hosts: ["cursor", "claude"],
		});
		expect(jobs).toEqual([
			{
				suite: "judge",
				scenario: "compares two workspace arms",
				host: "cursor",
				arm: "a",
				prompt: "Read word.txt. Reply with only that word. Do not add other words.",
			},
			{
				suite: "judge",
				scenario: "compares two workspace arms",
				host: "cursor",
				arm: "b",
				prompt: "Read word.txt. Reply with only that word. Do not add other words.",
			},
			{
				suite: "judge",
				scenario: "compares two workspace arms",
				host: "claude",
				arm: "a",
				prompt: "Read word.txt. Reply with only that word. Do not add other words.",
			},
			{
				suite: "judge",
				scenario: "compares two workspace arms",
				host: "claude",
				arm: "b",
				prompt: "Read word.txt. Reply with only that word. Do not add other words.",
			},
		]);
	});
});
