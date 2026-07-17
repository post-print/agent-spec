import { afterEach, describe, expect, it } from "vitest";

import { parseCliArgs } from "../cli.js";

describe("parseCliArgs debug flags", () => {
	const priorDebug = process.env.AGENT_TEST_DEBUG;
	const priorVerbose = process.env.AGENT_TEST_VERBOSE;
	const priorPaths = process.env.AGENT_TEST_VERBOSE_PATHS;

	afterEach(() => {
		if (priorDebug === undefined) {
			delete process.env.AGENT_TEST_DEBUG;
		} else {
			process.env.AGENT_TEST_DEBUG = priorDebug;
		}
		if (priorVerbose === undefined) {
			delete process.env.AGENT_TEST_VERBOSE;
		} else {
			process.env.AGENT_TEST_VERBOSE = priorVerbose;
		}
		if (priorPaths === undefined) {
			delete process.env.AGENT_TEST_VERBOSE_PATHS;
		} else {
			process.env.AGENT_TEST_VERBOSE_PATHS = priorPaths;
		}
	});

	it("enables debug from --debug and implies keep-recordings", () => {
		delete process.env.AGENT_TEST_DEBUG;
		const args = parseCliArgs(["node", "cli.js", "--debug", "--suite", "smoke"]);
		expect(args.debug).toBe(true);
		expect(args.keepRecordings).toBe(true);
		expect(process.env.AGENT_TEST_DEBUG).toBe("1");
	});

	it("enables debug from AGENT_TEST_DEBUG=1", () => {
		process.env.AGENT_TEST_DEBUG = "1";
		const args = parseCliArgs(["node", "cli.js", "--suite", "smoke"]);
		expect(args.debug).toBe(true);
		expect(args.keepRecordings).toBe(true);
	});

	it("resolves --debug-dir relative to cwd and enables debug", () => {
		delete process.env.AGENT_TEST_DEBUG;
		const args = parseCliArgs(["node", "cli.js", "--debug-dir", "out/debug"]);
		expect(args.debug).toBe(true);
		expect(args.debugDir).toBe(`${process.cwd()}/out/debug`);
		expect(args.keepRecordings).toBe(true);
	});

	it("rejects --debug-dir without a value", () => {
		expect(() => parseCliArgs(["node", "cli.js", "--debug-dir"])).toThrow(/--debug-dir requires/);
		expect(() => parseCliArgs(["node", "cli.js", "--debug-dir", "--suite", "x"])).toThrow(
			/--debug-dir requires/,
		);
	});

	it("parses validate and fail-on flags", () => {
		const args = parseCliArgs([
			"node",
			"cli.js",
			"--validate-only",
			"--validate-seeds",
			"--validate-paths",
			"--fail-on",
			"behavior",
		]);
		expect(args.validateOnly).toBe(true);
		expect(args.validateSeeds).toBe(true);
		expect(args.validatePaths).toBe(true);
		expect(args.failOn).toBe("behavior");
	});
});
