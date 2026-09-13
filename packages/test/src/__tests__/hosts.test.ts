import { afterEach, describe, expect, it } from "bun:test";

import { clearRegisteredHostAdapters } from "@post-print/agent-harness";

import { parseHostList, resolveSuiteHosts, scenarioRunsOnHost, uniqueHosts } from "../hosts.js";

afterEach(() => {
	clearRegisteredHostAdapters();
});

describe("parseHostList", () => {
	it("parses a single host", () => {
		expect(parseHostList("claude")).toEqual(["claude"]);
	});

	it("parses comma-separated hosts and drops duplicates", () => {
		expect(parseHostList("cursor, claude, cursor")).toEqual(["cursor", "claude"]);
	});

	it("expands all to cursor, claude, openai", () => {
		expect(parseHostList("all")).toEqual(["cursor", "claude", "openai"]);
	});

	it("keeps all-expansion order when mixed with names", () => {
		expect(parseHostList("all,cursor")).toEqual(["cursor", "claude", "openai"]);
	});

	it("rejects replay and unknown names", () => {
		expect(() => parseHostList("replay")).toThrow(/deprecated and no longer supported/i);
		expect(() => parseHostList("not_valid")).toThrow(/cursor\|claude\|openai\|all/);
		expect(parseHostList("gemini")).toEqual(["gemini"]);
		expect(() => parseHostList("")).toThrow(/cursor\|claude\|openai\|all/);
	});
});

describe("uniqueHosts", () => {
	it("returns undefined for an empty list", () => {
		expect(uniqueHosts(undefined)).toBeUndefined();
		expect(uniqueHosts([])).toBeUndefined();
	});

	it("keeps first-seen order", () => {
		expect(uniqueHosts(["openai", "cursor", "openai", "claude"])).toEqual([
			"openai",
			"cursor",
			"claude",
		]);
	});
});

describe("resolveSuiteHosts", () => {
	it("falls back to cursor, then defaults.host", () => {
		expect(resolveSuiteHosts({})).toEqual(["cursor"]);
		expect(resolveSuiteHosts({ defaultHost: "claude" })).toEqual(["claude"]);
	});

	it("uses suite hosts when the CLI does not set a host", () => {
		expect(resolveSuiteHosts({ suiteHosts: ["claude", "openai"] })).toEqual(["claude", "openai"]);
	});

	it("uses CLI hosts when the suite has no hosts list", () => {
		expect(resolveSuiteHosts({ cliHosts: ["openai", "cursor"] })).toEqual(["openai", "cursor"]);
	});

	it("intersects CLI hosts with suite hosts", () => {
		expect(
			resolveSuiteHosts({
				cliHosts: ["cursor", "claude", "openai"],
				suiteHosts: ["cursor", "openai"],
			}),
		).toEqual(["cursor", "openai"]);
		expect(
			resolveSuiteHosts({
				cliHosts: ["claude"],
				suiteHosts: ["cursor", "claude", "openai"],
			}),
		).toEqual(["claude"]);
	});

	it("rejects a CLI host that is outside the suite list", () => {
		expect(() =>
			resolveSuiteHosts({
				cliHosts: ["openai"],
				suiteHosts: ["cursor", "claude"],
			}),
		).toThrow(/does not match suite hosts/);
	});
});

describe("scenarioRunsOnHost", () => {
	it("runs every scenario when the host is not locked", () => {
		expect(scenarioRunsOnHost({ host: "claude" }, "cursor", false)).toBe(true);
		expect(scenarioRunsOnHost({}, "cursor", false)).toBe(true);
	});

	it("drops pinned scenarios that are not the locked host", () => {
		expect(scenarioRunsOnHost({ host: "claude" }, "cursor", true)).toBe(false);
		expect(scenarioRunsOnHost({ host: "claude" }, "claude", true)).toBe(true);
		expect(scenarioRunsOnHost({}, "cursor", true)).toBe(true);
	});
});
