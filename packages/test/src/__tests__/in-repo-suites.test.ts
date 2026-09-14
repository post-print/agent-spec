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
		expect(paths.some((path) => path.endsWith(join("smoke", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("tools", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("mcp", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("judge", "scenarios.json")))).toBe(true);
		expect(paths.some((path) => path.endsWith(join("depth", "scenarios.json")))).toBe(true);
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

	it("keeps depth as a workspace-root runner-seam suite", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		const suitePath = paths.find((path) => path.endsWith(join("depth", "scenarios.json")));
		expect(suitePath).toBeDefined();
		if (!suitePath) {
			return;
		}
		const suite = await loadSuiteFile(suitePath);
		expect(suite.scenarios.map((scenario) => scenario.name)).toEqual([
			"uses injected context",
			"applies a seed patch",
			"runs a required command",
			"follows a workspace skill",
			"sees only the workspace tree",
		]);
		expect(suite.scenarios.every((scenario) => scenario.workspace)).toBe(true);
	});
});
