import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectSuiteHosts, formatCheckReport, formatCheckSummary, runCheck } from "../check.js";
import { missingAgentAuth } from "../doctor.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(packageRoot, "../..");
const fixturesDir = join(packageRoot, "fixtures");

describe("check", () => {
	it("validates fixture smoke without launching an agent", async () => {
		const report = await runCheck({
			cwd: repoRoot,
			suitesDir: fixturesDir,
			filter: "smoke",
		});
		expect(report.suiteOk).toBe(true);
		expect(report.seedsOk).toBe(true);
		expect(report.ok).toBe(true);
		expect(report.hosts).toEqual(["cursor"]);
		expect(formatCheckReport(report)).toContain("agent-test check");
		expect(formatCheckSummary(report)).toContain("suite ok");
	});

	it("collects the suite default host when CLI host is unset", async () => {
		const hosts = await collectSuiteHosts({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
			filter: "smoke",
		});
		expect(hosts).toEqual(["cursor"]);
	});

	it("honors a CLI host override", async () => {
		const hosts = await collectSuiteHosts({
			cwd: repoRoot,
			suitesDir: fixturesDir,
			filter: "smoke",
			host: "claude",
		});
		expect(hosts).toEqual(["claude"]);
	});

	it("names missing Cursor auth", () => {
		const prior = process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_API_KEY;
		expect(missingAgentAuth("cursor")).toMatch(/CURSOR_API_KEY/);
		if (prior === undefined) {
			delete process.env.CURSOR_API_KEY;
		} else {
			process.env.CURSOR_API_KEY = prior;
		}
	});
});
