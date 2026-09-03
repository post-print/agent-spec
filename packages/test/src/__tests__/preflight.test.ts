import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertDirectAgentPreflight } from "../preflight.js";

const MISSING_SUITES_PATTERN = /Direct agent testing requires a suites directory/;

describe("assertDirectAgentPreflight", () => {
	it("passes when relative suites directory exists", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-"));
		await mkdir(join(repoRoot, "agent-suites"), { recursive: true });

		await expect(assertDirectAgentPreflight(repoRoot)).resolves.toBeUndefined();
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("passes when suitesDir is an absolute path outside repoRoot", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-repo-"));
		const suitesRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-suites-"));
		await mkdir(join(suitesRoot, "direct"), { recursive: true });
		await writeFile(
			join(suitesRoot, "direct", "scenarios.json"),
			JSON.stringify({ scenarios: [] }),
		);

		await expect(assertDirectAgentPreflight(repoRoot, suitesRoot)).resolves.toBeUndefined();
		await rm(repoRoot, { recursive: true, force: true });
		await rm(suitesRoot, { recursive: true, force: true });
	});

	it("throws when suites directory is missing and prints the resolved path", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-miss-"));
		const expected = resolve(repoRoot, "agent-suites");

		await expect(assertDirectAgentPreflight(repoRoot)).rejects.toThrow(MISSING_SUITES_PATTERN);
		await expect(assertDirectAgentPreflight(repoRoot)).rejects.toThrow(expected);
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("throws with absolute suitesDir when that path is missing", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-abs-miss-repo-"));
		const missingSuites = join(tmpdir(), `agent-test-preflight-abs-miss-${Date.now()}`);
		const expected = resolve(missingSuites);

		await expect(assertDirectAgentPreflight(repoRoot, missingSuites)).rejects.toThrow(
			MISSING_SUITES_PATTERN,
		);
		await expect(assertDirectAgentPreflight(repoRoot, missingSuites)).rejects.toThrow(expected);
		await rm(repoRoot, { recursive: true, force: true });
	});
});
