import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverSuites } from "../discover-suites.js";
import { shouldPrintSuiteChrome } from "../run-suite.js";

describe("discoverSuites", () => {
	it("skips directories without scenarios.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-"));
		await mkdir(join(dir, "empty-suite"));
		await mkdir(join(dir, "real-suite"));
		await writeFile(
			join(dir, "real-suite", "scenarios.json"),
			JSON.stringify({
				name: "real-suite",
				scenarios: [{ name: "x", prompt: "p", rubric: {} }],
			}),
		);

		const paths = await discoverSuites(dir);
		expect(paths).toEqual([join(dir, "real-suite", "scenarios.json")]);
	});
});

describe("shouldPrintSuiteChrome", () => {
	const prior = process.env.AGENT_TEST_CHILD;

	afterEach(() => {
		if (prior === undefined) {
			delete process.env.AGENT_TEST_CHILD;
		} else {
			process.env.AGENT_TEST_CHILD = prior;
		}
	});

	it("prints suite headers and verdicts in the parent process", () => {
		delete process.env.AGENT_TEST_CHILD;
		expect(shouldPrintSuiteChrome()).toBe(true);
	});

	it("suppresses suite headers and verdicts in live child subprocesses", () => {
		process.env.AGENT_TEST_CHILD = "1";
		expect(shouldPrintSuiteChrome()).toBe(false);
	});
});
