import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Normalize `git status --porcelain` stdout for leak snapshots.
 * Keep leading spaces — unstaged-only lines are ` M path` / ` D path`; trimming
 * the first space corrupts XY status and breaks seed-collateral path matching.
 */
export function normalizePorcelainStatus(stdout: string): string {
	return stdout.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** Porcelain snapshot of the caller repo root — used to detect live-run leakage. */
export async function captureWorkingTreeStatus(repoRoot: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
	return normalizePorcelainStatus(stdout);
}

/** Lines present after a scenario that were not in the before snapshot. */
export function findWorkingTreeLeak(before: string, after: string): string[] {
	const beforeLines = new Set(before.split("\n").filter(Boolean));
	return after
		.split("\n")
		.filter(Boolean)
		.filter((line) => !beforeLines.has(line));
}

/** Extract the path portion from a git status --porcelain line. */
export function porcelainPathFromStatusLine(line: string): string {
	const payload = line.slice(3).trim();
	if (!payload) {
		return "";
	}
	const renameArrow = " -> ";
	const arrowIndex = payload.indexOf(renameArrow);
	const pathToken = arrowIndex === -1 ? payload : payload.slice(arrowIndex + renameArrow.length);
	return unquoteGitPath(pathToken.trim());
}

function unquoteGitPath(token: string): string {
	if (token.startsWith('"') && token.endsWith('"')) {
		return token.slice(1, -1).replace(/\\(["\\nrt])/g, (_match, ch: string) => {
			switch (ch) {
				case "n":
					return "\n";
				case "r":
					return "\r";
				case "t":
					return "\t";
				default:
					return ch;
			}
		});
	}
	return token;
}

/** True when `target` is the same as or nested under `root`. */
export function isPathUnderRoot(target: string, root: string): boolean {
	const absTarget = resolve(target);
	const absRoot = resolve(root);
	const prefix = absRoot.endsWith(sep) ? absRoot : `${absRoot}${sep}`;
	return absTarget === absRoot || absTarget.startsWith(prefix);
}

/**
 * Staging/debug parent dirs under the caller repo that the harness writes during live runs.
 * These are excluded from worktree leak detection (they are runner artifacts, not agent edits).
 */
export function resolveHarnessArtifactIgnoreRoots(
	repoRoot: string,
	debugDirOverride?: string,
): string[] {
	if (!debugDirOverride?.trim()) {
		return [];
	}
	const debugRoot = resolve(debugDirOverride);
	if (!isPathUnderRoot(debugRoot, resolve(repoRoot))) {
		return [];
	}
	return [debugRoot];
}

/** Drop leak lines whose porcelain path sits under ignored harness artifact roots. */
export function filterWorkingTreeLeaks(
	leaked: string[],
	ignoreRoots: string[],
	repoRoot: string,
): string[] {
	if (ignoreRoots.length === 0) {
		return leaked;
	}
	const resolvedRoots = ignoreRoots.map((root) => resolve(repoRoot, root));
	return leaked.filter((line) => {
		const path = porcelainPathFromStatusLine(line);
		if (!path) {
			return true;
		}
		const absPath = resolve(repoRoot, path);
		return !resolvedRoots.some((root) => isPathUnderRoot(absPath, root));
	});
}

export function formatWorkingTreeLeak(lines: string[]): string {
	return lines.join("\n");
}

/** Restore tracked paths in the caller checkout (staged + working tree). */
export async function restoreWorkingTreePaths(repoRoot: string, paths: string[]): Promise<void> {
	const unique = [...new Set(paths.filter(Boolean))];
	if (unique.length === 0) {
		return;
	}
	await execFileAsync("git", ["restore", "--staged", "--worktree", "--", ...unique], {
		cwd: repoRoot,
	});
}
