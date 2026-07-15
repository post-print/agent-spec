import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createScenarioWorktree } from "@post-print/agent-harness";
import { describe, expect, it } from "vitest";

import { seedScenarioWorktree } from "../scenario-seed.js";

const execFileAsync = promisify(execFile);
const SEED_PATCH_NOT_FOUND = /seedPatch not found/;

async function initGitRepo(): Promise<string> {
	const repoRoot = await mkdtemp(join(tmpdir(), "agent-seed-"));
	await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
	await execFileAsync("git", ["config", "user.name", "test"], { cwd: repoRoot });
	await mkdir(join(repoRoot, "src"), { recursive: true });
	await writeFile(join(repoRoot, "src/example.ts"), "export const value = 1;\n", "utf8");
	await execFileAsync("git", ["add", "."], { cwd: repoRoot });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot });

	await writeFile(
		join(repoRoot, "src/example.ts"),
		"export const value = 1;\n// Agent-test seed\n",
		"utf8",
	);
	await mkdir(join(repoRoot, "agent-suites/fixtures"), { recursive: true });
	const { stdout: patch } = await execFileAsync("git", ["diff", "--", "src/example.ts"], {
		cwd: repoRoot,
	});
	await writeFile(join(repoRoot, "agent-suites/fixtures/example.patch"), patch, "utf8");
	await execFileAsync("git", ["checkout", "--", "src/example.ts"], { cwd: repoRoot });
	return repoRoot;
}

describe("seedScenarioWorktree", () => {
	it("applies patch and creates branch diff vs main", async () => {
		const repoRoot = await initGitRepo();
		const patchRel = "agent-suites/fixtures/example.patch";
		const worktree = await createScenarioWorktree(repoRoot, "seed-test");
		try {
			await seedScenarioWorktree(repoRoot, worktree.path, patchRel);
			const { stdout } = await execFileAsync("git", ["diff", "main...HEAD", "--", "src/"], {
				cwd: worktree.path,
			});
			expect(stdout).toContain("Agent-test seed");
		} finally {
			await worktree.cleanup();
		}
	});

	it("throws when patch path missing", async () => {
		const repoRoot = await initGitRepo();
		const worktree = await createScenarioWorktree(repoRoot, "seed-missing");
		try {
			await expect(
				seedScenarioWorktree(repoRoot, worktree.path, "agent-suites/nope.patch"),
			).rejects.toThrow(SEED_PATCH_NOT_FOUND);
		} finally {
			await worktree.cleanup();
		}
	});
});
