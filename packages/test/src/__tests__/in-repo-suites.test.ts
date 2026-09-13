import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverSuites } from "../discover-suites.js";
import { loadSuiteFile } from "../load-suite.js";
import { validateSuiteFile } from "../validate-suite.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("in-repo suites", () => {
	it("ships a smoke suite that validates without launching an agent", async () => {
		const paths = await discoverSuites(join(repoRoot, "agent-suites"));
		expect(paths.some((path) => path.includes(`${join("agent-suites", "smoke")}`))).toBe(true);
		const suitePath = paths.find((path) => path.endsWith(join("smoke", "scenarios.json")));
		expect(suitePath).toBeDefined();
		if (!suitePath) {
			return;
		}
		const suite = await loadSuiteFile(suitePath);
		expect(validateSuiteFile(suitePath, suite)).toEqual([]);
		expect(suite.scenarios.map((scenario) => scenario.name)).toContain(
			"reads a project skill file",
		);
		expect(
			suite.scenarios.find((scenario) => scenario.name === "reads a project skill file")?.skills,
		).toBeUndefined();
	});
});
