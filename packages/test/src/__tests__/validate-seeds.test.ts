import { describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { validateSeedPatches } from "../validate-seeds.js";

const execFileAsync = promisify(execFile);

describe("validateSeedPatches", () => {
	it("applies a seed patch on a scenario workspace copy", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "agent-seed-ws-"));
		await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
		await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
		await execFileAsync("git", ["config", "user.name", "test"], { cwd: repoRoot });
		await mkdir(join(repoRoot, "agent-suites/depth/workspaces/seed"), { recursive: true });
		await writeFile(
			join(repoRoot, "agent-suites/depth/workspaces/seed/seeded.txt"),
			"agent-test-depth-seed-before\n",
			"utf8",
		);
		await writeFile(
			join(repoRoot, "agent-suites/depth/workspaces/seed.patch"),
			[
				"diff --git a/seeded.txt b/seeded.txt",
				"--- a/seeded.txt",
				"+++ b/seeded.txt",
				"@@ -1 +1 @@",
				"-agent-test-depth-seed-before",
				"+agent-test-depth-seed-4e91",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(repoRoot, "agent-suites/depth/scenarios.json"),
			JSON.stringify({
				name: "depth",
				scenarios: [
					{
						name: "applies a seed patch",
						prompt: "read seeded.txt",
						workspace: "agent-suites/depth/workspaces/seed",
						seedPatch: "agent-suites/depth/workspaces/seed.patch",
						rubric: { must: ["agent-test-depth-seed-4e91"] },
					},
				],
			}),
			"utf8",
		);
		await execFileAsync("git", ["add", "."], { cwd: repoRoot });
		await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot });

		const report = await validateSeedPatches({
			cwd: repoRoot,
			suitesDir: "agent-suites",
		});
		expect(report.ok).toBe(true);
		expect(report.checked).toBe(1);
	});
});
