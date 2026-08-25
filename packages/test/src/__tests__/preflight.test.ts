import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assertLiveDogfoodPreflight } from "../preflight.js";

const MISSING_SUITES_PATTERN = /Live dogfood requires a suites directory/;

describe("assertLiveDogfoodPreflight", () => {
	it("passes when relative suites directory exists", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-"));
		await mkdir(join(repoRoot, "agent-suites"), { recursive: true });

		await expect(assertLiveDogfoodPreflight(repoRoot)).resolves.toBeUndefined();
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("passes when suitesDir is an absolute path outside repoRoot", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-repo-"));
		const suitesRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-suites-"));
		await mkdir(join(suitesRoot, "live-replay"), { recursive: true });
		await writeFile(
			join(suitesRoot, "live-replay", "scenarios.json"),
			JSON.stringify({ scenarios: [] }),
		);

		await expect(assertLiveDogfoodPreflight(repoRoot, suitesRoot)).resolves.toBeUndefined();
		await rm(repoRoot, { recursive: true, force: true });
		await rm(suitesRoot, { recursive: true, force: true });
	});

	it("throws when suites directory is missing and prints the resolved path", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-miss-"));
		const expected = resolve(repoRoot, "agent-suites");

		await expect(assertLiveDogfoodPreflight(repoRoot)).rejects.toThrow(MISSING_SUITES_PATTERN);
		await expect(assertLiveDogfoodPreflight(repoRoot)).rejects.toThrow(expected);
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("throws with absolute suitesDir when that path is missing", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-abs-miss-repo-"));
		const missingSuites = join(tmpdir(), `agent-test-preflight-abs-miss-${Date.now()}`);
		const expected = resolve(missingSuites);

		await expect(assertLiveDogfoodPreflight(repoRoot, missingSuites)).rejects.toThrow(
			MISSING_SUITES_PATTERN,
		);
		await expect(assertLiveDogfoodPreflight(repoRoot, missingSuites)).rejects.toThrow(expected);
		await rm(repoRoot, { recursive: true, force: true });
	});
});
