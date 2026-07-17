import { describe, expect, it } from "vitest";

import { formatDuration } from "../progress.js";
import { truncatePath, wrapText } from "../theme.js";

describe("formatDuration", () => {
	it("formats sub-second durations in ms", () => {
		expect(formatDuration(42)).toBe("42ms");
	});

	it("formats longer durations in seconds", () => {
		expect(formatDuration(4500)).toBe("4.5s");
	});
});

describe("truncatePath / wrapText (progress helpers)", () => {
	it("exposes path truncation used by themed phases", () => {
		const priorDebug = process.env.AGENT_TEST_DEBUG;
		const priorPaths = process.env.AGENT_TEST_VERBOSE_PATHS;
		delete process.env.AGENT_TEST_DEBUG;
		delete process.env.AGENT_TEST_VERBOSE_PATHS;
		expect(truncatePath("/a/b/c/d")).toBe("…/c/d");
		if (priorDebug === undefined) {
			delete process.env.AGENT_TEST_DEBUG;
		} else {
			process.env.AGENT_TEST_DEBUG = priorDebug;
		}
		if (priorPaths === undefined) {
			delete process.env.AGENT_TEST_VERBOSE_PATHS;
		} else {
			process.env.AGENT_TEST_VERBOSE_PATHS = priorPaths;
		}
	});

	it("exposes wrapText for verdict rationales", () => {
		expect(wrapText("hello world", 5)).toEqual(["hello", "world"]);
	});
});
