import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORKTREE_LIST_PATH_SPLIT = /\s+/;

export const SCENARIO_WORKTREE_DIR_PREFIX = "agent-harness-wt-";

export interface ScenarioWorktree {
	path: string;
	cleanup: () => Promise<void>;
}

function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

async function removeWorktreeAt(repoRoot: string, worktreePath: string): Promise<void> {
	try {
		await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
			cwd: repoRoot,
		});
	} catch {
		// Best-effort when worktree is already gone.
	}
	const parent = dirname(worktreePath);
	if (parent.includes(SCENARIO_WORKTREE_DIR_PREFIX)) {
		await rm(parent, { recursive: true, force: true });
	}
}

/** Remove orphaned agent-test worktrees left after SIGKILL (exit 137) or crash. */
export async function cleanupStaleScenarioWorktrees(repoRoot: string): Promise<string[]> {
	const { stdout } = await execFileAsync("git", ["worktree", "list"], { cwd: repoRoot });
	const removed: string[] = [];

	for (const line of stdout.split("\n")) {
		const path = line.split(WORKTREE_LIST_PATH_SPLIT)[0];
		if (!path?.includes(SCENARIO_WORKTREE_DIR_PREFIX)) {
			continue;
		}
		await removeWorktreeAt(repoRoot, path);
		removed.push(path);
	}

	return removed;
}

/** Detached git worktree so live agent runs do not mutate the caller's working tree. */
export async function createScenarioWorktree(
	repoRoot: string,
	label: string,
): Promise<ScenarioWorktree> {
	const parent = await mkdtemp(join(tmpdir(), SCENARIO_WORKTREE_DIR_PREFIX));
	const worktreePath = join(parent, slugify(label) || "scenario");

	await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
		cwd: repoRoot,
	});

	return {
		path: worktreePath,
		cleanup: async () => {
			await removeWorktreeAt(repoRoot, worktreePath);
		},
	};
}
