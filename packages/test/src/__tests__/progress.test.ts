import { describe, expect, it } from "bun:test";

import { formatDuration, resolveHeartbeatInterval, TTY_HEARTBEAT_MS } from "../progress.js";
import { formatClock, truncatePath, wrapText } from "../theme.js";

describe("formatDuration", () => {
	it("formats sub-second durations in ms", () => {
		expect(formatDuration(42)).toBe("42ms");
	});

	it("formats longer durations in seconds", () => {
		expect(formatDuration(4500)).toBe("4.5s");
	});
});

describe("formatClock", () => {
	it("prints tenths of a second", () => {
		expect(formatClock(0)).toBe("0.0s");
		expect(formatClock(1270)).toBe("1.3s");
	});
});

describe("resolveHeartbeatInterval", () => {
	it("uses a tenth of a second on a TTY", () => {
		expect(resolveHeartbeatInterval(true)).toBe(TTY_HEARTBEAT_MS);
		expect(TTY_HEARTBEAT_MS).toBe(100);
	});

	it("keeps a long interval when stdout is not a TTY", () => {
		expect(resolveHeartbeatInterval(false)).toBe(60_000);
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
