import { open, unlink } from "node:fs/promises";
import { join } from "node:path";

const LOCK_RETRY_MS = 50;
const LOCK_MAX_WAIT_MS = 120_000;

/**
 * Cross-process advisory lock for git worktree add/remove on one repo.
 * Concurrent live children race `git worktree` without this.
 */
export async function withWorktreeLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
	const lockPath = join(repoRoot, ".git", "agent-test-worktree.lock");
	const handle = await acquireExclusiveLock(lockPath);
	try {
		return await fn();
	} finally {
		await handle.close().catch(() => undefined);
		await unlink(lockPath).catch(() => undefined);
	}
}

async function acquireExclusiveLock(lockPath: string): Promise<Awaited<ReturnType<typeof open>>> {
	const deadline = Date.now() + LOCK_MAX_WAIT_MS;
	for (;;) {
		try {
			return await open(lockPath, "wx");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				throw error;
			}
			if (Date.now() >= deadline) {
				throw new Error(`timed out waiting for worktree lock: ${lockPath}`);
			}
			await sleep(LOCK_RETRY_MS);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
