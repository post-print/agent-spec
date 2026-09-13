import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverSuites } from "../discover-suites.js";
import { loadSuiteFile } from "../load-suite.js";
import { validateSuiteFile, validateSuitePaths } from "../validate-suite.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("in-repo suites", () => {
	it("validates every host-agent suite without launching an agent", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		expect(paths.some((path) => path.endsWith(join("smoke", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("tools", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("mcp", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("judge", "scenarios.json")))).toBe(true);
		for (const suitePath of paths) {
			const suite = await loadSuiteFile(suitePath);
			expect(validateSuiteFile(suitePath, suite)).toEqual([]);
			expect(suite.hosts).toEqual(["cursor", "claude", "openai"]);
		}
		const report = await validateSuitePaths(paths, {
			validatePaths: true,
			repoRoot,
		});
		expect(report.ok).toBe(true);
	});

	it("keeps smoke as a short host proof", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		const suitePath = paths.find((path) => path.endsWith(join("smoke", "scenarios.json")));
		expect(suitePath).toBeDefined();
		if (!suitePath) {
			return;
		}
		const suite = await loadSuiteFile(suitePath);
		expect(suite.scenarios.map((scenario) => scenario.name)).toContain(
			"reads a project skill file",
		);
	});
});
