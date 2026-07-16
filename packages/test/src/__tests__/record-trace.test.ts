import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
	cleanupLegacyRepoRecordings,
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
	it("returns repo fixture path when recordFixtures is true", () => {
		const resolved = resolveRecordingPath(
			"ambient-routing",
			"medium: grill skill",
			"agent-suites/ambient-routing/fixtures/replays/medium-grill-skill.json",
			true,
			{ repoRoot: "/repo" },
		);

		expect(resolved).toEqual({
			kind: "fixture",
			path: resolve(
				"/repo",
				"agent-suites/ambient-routing/fixtures/replays/medium-grill-skill.json",
			),
		});
	});

	it("returns tmpdir session path for live staging", () => {
		const resolved = resolveRecordingPath(
			"ambient-routing",
			"medium: grill skill",
			"agent-suites/ambient-routing/fixtures/replays/medium-grill-skill.json",
			false,
			{ repoRoot: "/repo", stagingSessionId: "sess-1" },
		);

		expect(resolved?.kind).toBe("staging");
		expect(resolved?.path).toBe(
			getStagingTracePath("sess-1", "ambient-routing", "medium: grill skill"),
		);
	});

	it("returns staging path without replayTrace when stagingSessionId is set", () => {
		const resolved = resolveRecordingPath("live-only", "anti-thrash", undefined, false, {
			repoRoot: "/repo",
			stagingSessionId: "sess-2",
		});

		expect(resolved).toEqual({
			kind: "staging",
			path: getStagingTracePath("sess-2", "live-only", "anti-thrash"),
		});
	});

	it("returns undefined when replayTrace is missing and recordFixtures is true", () => {
		expect(
			resolveRecordingPath("suite", "name", undefined, true, {
				repoRoot: "/repo",
			}),
		).toBeUndefined();
	});

	it("returns undefined when stagingSessionId is missing for live staging", () => {
		expect(
			resolveRecordingPath("suite", "name", undefined, false, {
				repoRoot: "/repo",
			}),
		).toBeUndefined();
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

describe("cleanupLegacyRepoRecordings", () => {
	it("removes legacy fixtures/recordings directories under suites", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-legacy-"));
		const legacyDir = join(repoRoot, "agent-suites/ambient-routing/fixtures/recordings");
		await mkdir(legacyDir, { recursive: true });
		await writeFile(join(legacyDir, "old.json"), "{}\n", "utf8");

		const removed = await cleanupLegacyRepoRecordings(repoRoot);
		expect(removed).toEqual([legacyDir]);

		await expect(writeFile(join(legacyDir, "x"), "")).rejects.toThrow();

		await rm(repoRoot, { recursive: true, force: true });
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
