import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	cleanupStagingSession,
	getLiveStagingRoot,
	getLiveStagingSessionRoot,
	getStagingAgentStartPath,
	getStagingResultPath,
	getStagingTracePath,
	loadStagingResult,
	loadStagingTrace,
	readAgentStartMarker,
	recordTrace,
	resolveRecordingPath,
	setLiveStagingRootOverride,
	writeAgentStartMarker,
	writeStagingResult,
} from "../record-trace.js";

describe("resolveRecordingPath", () => {
	it("returns the transient session path", () => {
		const resolved = resolveRecordingPath("ambient-routing", "medium: grill skill", "sess-1");

		expect(resolved).toBe(getStagingTracePath("sess-1", "ambient-routing", "medium: grill skill"));
	});

	it("returns undefined without a staging session", () => {
		expect(resolveRecordingPath("suite", "name", undefined)).toBeUndefined();
	});
});

describe("staging result sidecar", () => {
	it("round-trips child rubric failures for parent merge", async () => {
		const sessionId = `sidecar-${Date.now()}`;
		const path = getStagingResultPath(sessionId, "routing", "anti-thrash");
		const payload = {
			passed: false,
			durationMs: 42,
			failures: [
				{
					matcher: "toHaveInvokedSkill",
					message: 'expected skill "grill"',
				},
			],
		};

		await writeStagingResult(path, payload);
		await expect(loadStagingResult(path)).resolves.toEqual(payload);

		await cleanupStagingSession(getLiveStagingSessionRoot(sessionId));
	});
});

describe("recordTrace", () => {
	it("persists assistantTextBeforeTools for parent debug rewrites", async () => {
		const sessionId = `trace-prefix-${Date.now()}`;
		const path = getStagingTracePath(sessionId, "smoke", "prefix");
		await recordTrace(path, {
			messages: [{ role: "assistant", content: "after tools" }],
			toolCalls: [{ name: "Shell", input: {} }],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "Reading files…",
		});

		const loaded = await loadStagingTrace(path);
		expect(loaded.assistantTextBeforeTools).toBe("Reading files…");

		await cleanupStagingSession(getLiveStagingSessionRoot(sessionId));
	});
});

describe("setLiveStagingRootOverride", () => {
	it("remounts the sessions parent used by staging paths", () => {
		const prior = undefined;
		const root = join(tmpdir(), `agent-test-debug-dir-${Date.now()}`);
		try {
			setLiveStagingRootOverride(root);
			expect(getLiveStagingRoot()).toBe(join(root, "sessions"));
			expect(getLiveStagingSessionRoot("sess")).toBe(join(root, "sessions", "sess"));
		} finally {
			setLiveStagingRootOverride(prior);
		}
	});
});

describe("agent start marker", () => {
	it("round-trips epoch ms for parent subprocess kill alignment", async () => {
		const sessionId = `agent-start-${Date.now()}`;
		const path = getStagingAgentStartPath(sessionId, "routing", "seeded");
		const before = Date.now();
		await writeAgentStartMarker(path);
		const marker = await readAgentStartMarker(path);
		expect(marker).toBeGreaterThanOrEqual(before);
		expect(marker).toBeLessThanOrEqual(Date.now());

		await cleanupStagingSession(getLiveStagingSessionRoot(sessionId));
	});
});

describe("cleanupStagingSession", () => {
	it("removes the session directory under tmpdir", async () => {
		const sessionRoot = getLiveStagingSessionRoot("cleanup-test");
		await mkdir(sessionRoot, { recursive: true });
		await writeFile(join(sessionRoot, "trace.json"), "{}\n", "utf8");

		await cleanupStagingSession(sessionRoot);

		await expect(writeFile(join(sessionRoot, "x"), "")).rejects.toThrow();
	});
});
