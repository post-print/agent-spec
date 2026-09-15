import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandViewerJobs, loadViewerCatalog } from "../viewer/catalog.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("loadViewerCatalog", () => {
	it("keeps compare judge criteria at comparison level", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-test-viewer-catalog-"));
		const suiteDir = join(root, "comparison");
		await mkdir(suiteDir);
		await writeFile(
			join(suiteDir, "scenarios.json"),
			JSON.stringify({
				name: "comparison",
				defaults: { host: "cursor" },
				scenarios: [
					{
						name: "shared judge ownership",
						prompt: "Compare the answers.",
						rubric: { judge: [{ id: "shared", question: "Which answer is safer?" }] },
						compare: {
							a: { description: "Control." },
							b: { description: "Candidate." },
							judgeMetrics: [{ id: "safe", question: "Is this answer safe?" }],
						},
					},
				],
			}),
		);

		const catalog = await loadViewerCatalog({ cwd: root, suitesDir: root });
		const scenario = catalog.suites[0]?.scenarios[0];
		expect(scenario?.rubric.judge).toEqual([{ id: "shared", question: "Which answer is safer?" }]);
		expect(scenario?.judgeMetrics).toEqual([{ id: "safe", question: "Is this answer safe?" }]);
		expect(scenario?.compare?.every((arm) => arm.rubric.judge === undefined)).toBe(true);
	});

	it("lists fixture suites with prompt and rubric without selecting a host", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "packages/test/fixtures"),
		});

		expect(catalog.defaultSelectedHosts).toEqual([]);
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
		expect(mcp?.suppliedMcp).toEqual([
			{
				name: "echo",
				tools: ["echo", "lookup", "search_tasks", "get_task", "task_index"],
			},
		]);
	});

	it("lists the capability suite and tour compare arms", async () => {
		const catalog = await loadViewerCatalog({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});

		const capabilities = catalog.suites.find((suite) => suite.name === "test-sdk-capabilities");
		expect(capabilities?.description).toBe(
			"Manual live checks for the supported runAgentTest inputs, trace capture, scoring, isolation, judging, and comparisons.",
		);
		expect(capabilities?.hosts).toEqual(["cursor", "claude", "openai"]);
		expect(capabilities?.scenarios).toHaveLength(11);
		const capabilityCompare = capabilities?.scenarios.find(
			(scenario) => scenario.name === "runs comparison arms and gates",
		);
		expect(capabilityCompare?.compare?.[0]).toMatchObject({
			id: "expected-failure",
			prompt: "Reply with exactly: CAPABILITY_CONTROL",
			rubric: { must: ["CAPABILITY_COMPARE_OK"] },
		});
		expect(capabilityCompare?.compare?.[1]).toMatchObject({
			id: "passing-arm",
			prompt: "Reply with exactly: CAPABILITY_COMPARE_OK",
			rubric: { must: ["CAPABILITY_COMPARE_OK"] },
		});

		const tour = catalog.suites.find((suite) => suite.name === "tour");
		expect(tour?.description).toBe(
			"A guided tour of agent-test: project work, diagnosis, repair, MCP tools, skills, and controlled comparisons.",
		);
		const compare = tour?.scenarios.find(
			(scenario) => scenario.name === "compares three MCP workflows",
		);
		expect(compare?.description).toBe(
			"Determines which task lookup workflow is most accurate and efficient.",
		);
		expect(compare?.prompt).toBe(
			"Determine which task lookup workflow provides the most accurate result with the fewest tools and tokens.",
		);
		expect(compare?.compare?.map((arm) => arm.id)).toEqual([
			"summary-only",
			"search-detail",
			"direct-detail",
		]);
		expect(compare?.compare?.every((arm) => arm.prompt.length > 0)).toBe(true);
		expect(compare?.compare?.every((arm) => arm.rubric.must?.includes("2026-09-24"))).toBe(true);
		expect(compare?.suppliedMcp?.[0]).toMatchObject({
			name: "tasks",
			tools: ["echo", "lookup", "search_tasks", "get_task", "task_index"],
		});
		expect(compare?.compare?.every((arm) => arm.suppliedMcp?.[0]?.name === "tasks")).toBe(true);
		expect(compare?.gates).toHaveLength(5);
		expect(compare?.gates).toContainEqual({
			metric: "tokens",
			winner: "direct-detail",
			loser: "search-detail",
		});

		const skill = tour?.scenarios.find((scenario) => scenario.name === "follows the release skill");
		expect(skill?.suppliedSkills).toEqual([".agents/skills/release-note/SKILL.md"]);
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
