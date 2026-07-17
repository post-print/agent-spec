import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SEED_COMMIT_MESSAGE = "agent-test: seed scenario diff (ephemeral worktree only)";

export interface CallerHeadSnapshot {
	ref: string;
	detached: boolean;
}

/** Record caller HEAD before worktree seeding so we can undo accidental checkouts. */
export async function captureCallerHead(repoRoot: string): Promise<CallerHeadSnapshot> {
	try {
		const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
			cwd: repoRoot,
		});
		return { ref: stdout.trim(), detached: false };
	} catch {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
			cwd: repoRoot,
		});
		return { ref: stdout.trim(), detached: true };
	}
}

/** Restore caller branch/detach point if a seed commit leaked onto the main worktree. */
export async function restoreCallerHeadIfSeedCommit(
	repoRoot: string,
	snapshot: CallerHeadSnapshot,
): Promise<void> {
	const { stdout: message } = await execFileAsync("git", ["log", "-1", "--format=%s"], {
		cwd: repoRoot,
	});
	if (message.trim() !== SEED_COMMIT_MESSAGE) {
		return;
	}

	if (snapshot.detached) {
		await execFileAsync("git", ["checkout", "--detach", snapshot.ref], {
			cwd: repoRoot,
		});
		return;
	}

	await execFileAsync("git", ["checkout", snapshot.ref], { cwd: repoRoot });
}

/** Apply optional patch and commit so pr-mode `git diff main...HEAD` has scope. */
export async function seedScenarioWorktree(
	repoRoot: string,
	worktreePath: string,
	seedPatch: string | undefined,
	options?: { stageOnly?: boolean },
): Promise<void> {
	if (!seedPatch) {
		return;
	}

	const patchPath = resolve(repoRoot, seedPatch);
	try {
		await access(patchPath);
	} catch {
		throw new Error(`seedPatch not found: ${seedPatch}`);
	}

	await execFileAsync("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: worktreePath });
	await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
	const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
		cwd: worktreePath,
	});
	if (!status.trim()) {
		throw new Error(`seedPatch applied no changes: ${seedPatch}`);
	}
	if (options?.stageOnly) {
		return;
	}
	await execFileAsync(
		"git",
		[
			"-c",
			"user.email=agent-test@agent-spec.local",
			"-c",
			"user.name=agent-test",
			"commit",
			"--no-verify",
			"-m",
			SEED_COMMIT_MESSAGE,
		],
		{ cwd: worktreePath },
	);
}
