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
});

describe("parseCliArgs workers", () => {
	const priorWorkers = process.env.AGENT_TEST_WORKERS;

	afterEach(() => {
		if (priorWorkers === undefined) {
			delete process.env.AGENT_TEST_WORKERS;
		} else {
			process.env.AGENT_TEST_WORKERS = priorWorkers;
		}
	});

	it("parses --workers", () => {
		delete process.env.AGENT_TEST_WORKERS;
		const args = parseCliArgs(["node", "cli.js", "--workers", "4", "--suite", "smoke"]);
		expect(args.workers).toBe(4);
	});

	it("reads AGENT_TEST_WORKERS when flag omitted", () => {
		process.env.AGENT_TEST_WORKERS = "3";
		const args = parseCliArgs(["node", "cli.js", "--suite", "smoke"]);
		expect(args.workers).toBe(3);
	});

	it("lets --workers override env", () => {
		process.env.AGENT_TEST_WORKERS = "3";
		const args = parseCliArgs(["node", "cli.js", "--workers", "2"]);
		expect(args.workers).toBe(2);
	});

	it("rejects invalid --workers", () => {
		expect(() => parseCliArgs(["node", "cli.js", "--workers", "0"])).toThrow(/--workers/);
		expect(() => parseCliArgs(["node", "cli.js", "--workers"])).toThrow(/--workers/);
	});

	it("leaves workers undefined by default", () => {
		delete process.env.AGENT_TEST_WORKERS;
		const args = parseCliArgs(["node", "cli.js", "--suite", "smoke"]);
		expect(args.workers).toBeUndefined();
	});
});
