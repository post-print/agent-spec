import { describe, expect, it } from "vitest";

import {
	DEFAULT_LIVE_TIMEOUT_MS,
	LIVE_SUBPROCESS_SETUP_MAX_MS,
	LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS,
	liveSubprocessTimeoutMs,
	resolveLiveTimeoutMs,
} from "../live-timeout.js";

describe("resolveLiveTimeoutMs", () => {
	it("defaults live runs to ten minutes", () => {
		const prior = process.env.AGENT_TEST_TIMEOUT_MS;
		delete process.env.AGENT_TEST_TIMEOUT_MS;
		expect(resolveLiveTimeoutMs()).toBe(DEFAULT_LIVE_TIMEOUT_MS);
		if (prior !== undefined) {
			process.env.AGENT_TEST_TIMEOUT_MS = prior;
		}
	});

	it("honors CLI override", () => {
		expect(resolveLiveTimeoutMs(120_000)).toBe(120_000);
	});

	it("treats zero override as disabled", () => {
		expect(resolveLiveTimeoutMs(0)).toBeUndefined();
	});

	it("reads AGENT_TEST_TIMEOUT_MS from the environment", () => {
		const prior = process.env.AGENT_TEST_TIMEOUT_MS;
		process.env.AGENT_TEST_TIMEOUT_MS = "90000";
		expect(resolveLiveTimeoutMs()).toBe(90_000);
		if (prior !== undefined) {
			process.env.AGENT_TEST_TIMEOUT_MS = prior;
		} else {
			delete process.env.AGENT_TEST_TIMEOUT_MS;
		}
	});

	it("disables timeout when AGENT_TEST_TIMEOUT_MS is 0", () => {
		const prior = process.env.AGENT_TEST_TIMEOUT_MS;
		process.env.AGENT_TEST_TIMEOUT_MS = "0";
		expect(resolveLiveTimeoutMs()).toBeUndefined();
		if (prior !== undefined) {
			process.env.AGENT_TEST_TIMEOUT_MS = prior;
		} else {
			delete process.env.AGENT_TEST_TIMEOUT_MS;
		}
	});
});

describe("liveSubprocessTimeoutMs", () => {
	it("adds a parent kill buffer beyond the harness deadline", () => {
		expect(liveSubprocessTimeoutMs(600_000)).toBe(600_000 + LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS);
	});
});

describe("LIVE_SUBPROCESS_SETUP_MAX_MS", () => {
	it("allows generous worktree and seed setup before parent setup-timeout", () => {
		expect(LIVE_SUBPROCESS_SETUP_MAX_MS).toBeGreaterThanOrEqual(300_000);
	});
});
