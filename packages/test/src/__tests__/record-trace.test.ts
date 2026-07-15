import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	getLiveStagingSessionRoot,
	resolveRecordingPath,
} from "../record-trace";

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
			join(getLiveStagingSessionRoot("sess-1"), "ambient-routing", "medium-grill-skill.json"),
		);
	});

	it("returns undefined when replayTrace is missing", () => {
		expect(
			resolveRecordingPath("suite", "name", undefined, false, {
				repoRoot: "/repo",
				stagingSessionId: "sess-1",
			}),
		).toBeUndefined();
	});
});

describe("cleanupLegacyRepoRecordings", () => {
	it("removes legacy fixtures/recordings directories under suites", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-legacy-"));
		const legacyDir = join(
			repoRoot,
			"agent-suites/ambient-routing/fixtures/recordings",
		);
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
