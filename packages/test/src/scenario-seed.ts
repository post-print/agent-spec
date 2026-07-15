import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SEED_COMMIT_MESSAGE = "agent-test: seed scenario diff (ephemeral worktree only)";

/** Apply optional patch and commit so pr-mode `git diff main...HEAD` has scope. */
export async function seedScenarioWorktree(
	repoRoot: string,
	worktreePath: string,
	seedPatch: string | undefined,
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
