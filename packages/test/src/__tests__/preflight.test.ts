import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertLiveDogfoodPreflight } from "../preflight";

const MISSING_SUITES_PATTERN = /Live dogfood requires a suites directory/;

describe("assertLiveDogfoodPreflight", () => {
	it("passes when suites directory exists", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-"));
		await mkdir(join(repoRoot, "agent-suites"), { recursive: true });

		await expect(assertLiveDogfoodPreflight(repoRoot)).resolves.toBeUndefined();
		await rm(repoRoot, { recursive: true, force: true });
	});

	it("throws when suites directory is missing", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-test-preflight-miss-"));

		await expect(assertLiveDogfoodPreflight(repoRoot)).rejects.toThrow(MISSING_SUITES_PATTERN);
		await rm(repoRoot, { recursive: true, force: true });
	});
});
