import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCompareArm, resolveCompareArms } from "../compare-scenario.js";
import { discoverSuites } from "../discover-suites.js";
import { loadSuiteFile } from "../load-suite.js";
import {
	resolveScenarioWorkspaceRel,
	validateSuiteFile,
	validateSuitePaths,
} from "../validate-suite.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("in-repo suites", () => {
	it("validates every host-agent suite without launching an agent", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		expect(paths.some((path) => path.endsWith(join("confidence", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("tour", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("reference", "scenarios.json")))).toBe(true);
		for (const suitePath of paths) {
			const suite = await loadSuiteFile(suitePath);
			expect(validateSuiteFile(suitePath, suite)).toEqual([]);
			expect(suite.hosts).toEqual(["cursor", "claude", "openai"]);
			expect(suite.defaults?.allowUserSkills).toBe(false);
			for (const scenario of suite.scenarios) {
				if (scenario.compare) {
					for (const entry of resolveCompareArms(scenario.compare)) {
						expect(
							resolveScenarioWorkspaceRel(suite, applyCompareArm(scenario, entry.id)),
						).toBeDefined();
					}
				} else {
					expect(resolveScenarioWorkspaceRel(suite, scenario)).toBeDefined();
				}
				expect(scenario.allowUserSkills).not.toBe(true);
			}
		}
		const report = await validateSuitePaths(paths, {
			validatePaths: true,
			repoRoot,
		});
		expect(report.ok).toBe(true);
	});

	it("keeps confidence as a six-scenario host proof", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		const suitePath = paths.find((path) => path.endsWith(join("confidence", "scenarios.json")));
		expect(suitePath).toBeDefined();
		if (!suitePath) {
			return;
		}
		const suite = await loadSuiteFile(suitePath);
		expect(suite.scenarios).toHaveLength(6);
		expect(suite.scenarios.map((scenario) => scenario.name)).toContain(
			"uses two MCP tools in order",
		);
	});

	it("keeps the tour as seven independent scenarios", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		const suitePath = paths.find((path) => path.endsWith(join("tour", "scenarios.json")));
		expect(suitePath).toBeDefined();
		if (!suitePath) {
			return;
		}
		const suite = await loadSuiteFile(suitePath);
		expect(suite.scenarios).toHaveLength(7);
		expect(suite.scenarios.map((scenario) => scenario.name)).toContain(
			"measures the value of a helpful tool",
		);
		expect(suite.defaults?.workspace).toBe("agent-suites/fixtures/task-list");
	});
});
