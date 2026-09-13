import { afterEach, describe, expect, it } from "bun:test";

import {
	formatHostLogLine,
	hostLogsVerbose,
	parseHostLogLine,
	shouldPrintHostLog,
} from "../host-log.js";

describe("parseHostLogLine", () => {
	it("parses a Cursor SDK INFO line and shortens the service name", () => {
		const parsed = parseHostLogLine(
			"22:13:48.149 INFO  AgentSkillsCursorRulesService load completed meta={durationMs: 124, ruleCount: 105, skillCount: 105}",
		);
		expect(parsed).toEqual({
			time: "22:13:48.149",
			level: "info",
			service: "skills",
			message: "load completed",
			meta: { durationMs: "124", ruleCount: "105", skillCount: "105" },
		});
	});

	it("parses project rule loads", () => {
		const parsed = parseHostLogLine(
			"22:13:48.069 INFO  LocalCursorRulesService load completed meta={durationMs: 45, ruleCount: 1}",
		);
		expect(parsed?.service).toBe("project-rules");
		expect(parsed?.meta.ruleCount).toBe("1");
	});

	it("ignores agent-test progress lines", () => {
		expect(parseHostLogLine("  agent  completed 5.8s")).toBeUndefined();
		expect(parseHostLogLine("[1/2] hello  (cursor)")).toBeUndefined();
	});

	it("treats CursorRulesService lines without a timestamp as host noise", () => {
		expect(
			parseHostLogLine("LocalCursorRulesService load completed meta={ruleCount: 1}")?.level,
		).toBe("info");
	});
});

describe("formatHostLogLine", () => {
	it("prints a compact host line", () => {
		const line = formatHostLogLine({
			level: "info",
			service: "skills",
			message: "load completed",
			meta: { durationMs: "124", skillCount: "105" },
		});
		expect(line).toContain("host");
		expect(line).toContain("INFO");
		expect(line).toContain("skills");
		expect(line).toContain("load completed");
		expect(line).toContain("124ms");
		expect(line).toContain("105 skills");
	});
});

describe("shouldPrintHostLog", () => {
	const priorDebug = process.env.AGENT_TEST_DEBUG;
	const priorVerbose = process.env.AGENT_TEST_VERBOSE;
	const priorHost = process.env.AGENT_TEST_HOST_LOGS;

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
		if (priorHost === undefined) {
			delete process.env.AGENT_TEST_HOST_LOGS;
		} else {
			process.env.AGENT_TEST_HOST_LOGS = priorHost;
		}
	});

	it("hides INFO unless debug or verbose", () => {
		delete process.env.AGENT_TEST_DEBUG;
		delete process.env.AGENT_TEST_VERBOSE;
		delete process.env.AGENT_TEST_HOST_LOGS;
		expect(hostLogsVerbose()).toBe(false);
		expect(shouldPrintHostLog("info")).toBe(false);
		expect(shouldPrintHostLog("debug")).toBe(false);
		expect(shouldPrintHostLog("warn")).toBe(true);
		expect(shouldPrintHostLog("error")).toBe(true);
	});

	it("shows INFO when AGENT_TEST_HOST_LOGS=1", () => {
		delete process.env.AGENT_TEST_DEBUG;
		delete process.env.AGENT_TEST_VERBOSE;
		process.env.AGENT_TEST_HOST_LOGS = "1";
		expect(shouldPrintHostLog("info")).toBe(true);
	});
});
