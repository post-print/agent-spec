import { afterEach, describe, expect, it } from "bun:test";

import { parseCliArgs, resolveReportOutput } from "../cli.js";

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

	it("parses --scenario-retries", () => {
		const args = parseCliArgs(["node", "cli.js", "--scenario-retries", "0"]);
		expect(args.scenarioRetries).toBe(0);
		expect(args.host).toBeUndefined();
	});

	it("rejects removed replay-era flags", () => {
		expect(() => parseCliArgs(["node", "cli.js", "--live"])).toThrow(/always runs a real agent/);
		expect(() => parseCliArgs(["node", "cli.js", "--record"])).toThrow(
			/capture transient traces automatically/,
		);
		expect(() => parseCliArgs(["node", "cli.js", "--record-fixtures"])).toThrow(
			/replay-based testing is deprecated/,
		);
		expect(() => parseCliArgs(["node", "cli.js", "--host", "replay"])).toThrow(
			/replay-based testing is deprecated/i,
		);
	});

	it("rejects invalid --scenario-retries", () => {
		expect(() => parseCliArgs(["node", "cli.js", "--scenario-retries", "-1"])).toThrow(
			/--scenario-retries must be an integer >= 0/,
		);
		expect(() => parseCliArgs(["node", "cli.js", "--scenario-retries", "1.5"])).toThrow(
			/--scenario-retries must be an integer >= 0/,
		);
	});

	it("parses compare subcommand and --compare-pairs", () => {
		const compare = parseCliArgs([
			"node",
			"cli.js",
			"compare",
			"--a",
			"a.json",
			"--b",
			"b.json",
			"--out-dir",
			"out/compare",
		]);
		expect(compare.compareMode).toBe(true);
		expect(compare.compareA).toBe("a.json");
		expect(compare.compareB).toBe("b.json");
		expect(compare.compareOutDir).toBe(`${process.cwd()}/out/compare`);

		const pairs = parseCliArgs([
			"node",
			"cli.js",
			"--compare-pairs",
			"skeleton-clean:skeleton-messy",
		]);
		expect(pairs.comparePairs).toBe("skeleton-clean:skeleton-messy");
		expect(pairs.host).toBeUndefined();
	});
});

describe("--report-out", () => {
	it("resolves a path relative to cwd", () => {
		const args = parseCliArgs(["node", "cli.js", "--report-out", "out/reports"]);
		expect(args.reportOut).toBe(`${process.cwd()}/out/reports`);
		expect(args.htmlReport).toBe(true);
	});

	it("treats a .html path as the report file and writes nothing else there", () => {
		expect(resolveReportOutput("/tmp/x/run.html")).toEqual({ htmlPath: "/tmp/x/run.html" });
		expect(resolveReportOutput("/tmp/x/RUN.HTML")).toEqual({ htmlPath: "/tmp/x/RUN.HTML" });
	});

	it("treats any other path as a directory that collects all report content", () => {
		expect(resolveReportOutput("/tmp/x/reports")).toEqual({
			htmlPath: "/tmp/x/reports/report.html",
			outDir: "/tmp/x/reports",
		});
	});

	it("is inert when unset", () => {
		expect(resolveReportOutput(undefined)).toEqual({});
	});
});
