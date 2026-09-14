import { afterEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { setProcessAuthMode } from "@post-print/agent-harness";

import { collectSuiteHosts, formatCheckReport, formatCheckSummary, runCheck } from "../check.js";
import { missingAgentAuth } from "../doctor.js";

afterEach(() => {
	setProcessAuthMode(undefined);
});

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

	it("collects the suite host matrix when CLI host is unset", async () => {
		const hosts = await collectSuiteHosts({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
			filter: "smoke",
		});
		expect(hosts).toEqual(["cursor", "claude", "openai"]);
	});

	it("collects every host used by in-repo suites", async () => {
		const hosts = await collectSuiteHosts({
			cwd: repoRoot,
			suitesDir: join(repoRoot, "agent-suites"),
		});
		expect(hosts).toEqual(["cursor", "claude", "openai"]);
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

	it("keeps a CLI host matrix", async () => {
		const hosts = await collectSuiteHosts({
			cwd: repoRoot,
			suitesDir: fixturesDir,
			filter: "smoke",
			hosts: ["cursor", "claude"],
		});
		expect(hosts).toEqual(["cursor", "claude"]);
	});

	it("accepts Cursor under the subscription default", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_AUTH_MODE;
		expect(missingAgentAuth("cursor")).toBeUndefined();
		if (prior === undefined) {
			delete process.env.CURSOR_API_KEY;
		} else {
			process.env.CURSOR_API_KEY = prior;
		}
		if (priorMode === undefined) {
			delete process.env.CURSOR_AUTH_MODE;
		} else {
			process.env.CURSOR_AUTH_MODE = priorMode;
		}
	});

	it("names missing Cursor auth when --auth-mode api-key has no key", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_AUTH_MODE;
		setProcessAuthMode("api-key");
		expect(missingAgentAuth("cursor")).toMatch(/CURSOR_API_KEY/);
		if (prior === undefined) {
			delete process.env.CURSOR_API_KEY;
		} else {
			process.env.CURSOR_API_KEY = prior;
		}
		if (priorMode === undefined) {
			delete process.env.CURSOR_AUTH_MODE;
		} else {
			process.env.CURSOR_AUTH_MODE = priorMode;
		}
	});

	it("accepts a Cursor SDK login when CURSOR_AUTH_MODE=subscription", () => {
		const prior = process.env.CURSOR_API_KEY;
		const priorMode = process.env.CURSOR_AUTH_MODE;
		delete process.env.CURSOR_API_KEY;
		process.env.CURSOR_AUTH_MODE = "subscription";
		try {
			expect(missingAgentAuth("cursor")).toBeUndefined();
		} finally {
			if (prior === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = prior;
			}
			if (priorMode === undefined) {
				delete process.env.CURSOR_AUTH_MODE;
			} else {
				process.env.CURSOR_AUTH_MODE = priorMode;
			}
		}
	});
});
