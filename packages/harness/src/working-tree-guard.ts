import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Porcelain snapshot of the caller repo root — used to detect live-run leakage. */
export async function captureWorkingTreeStatus(repoRoot: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
	return stdout.trim();
}

/** Lines present after a scenario that were not in the before snapshot. */
export function findWorkingTreeLeak(before: string, after: string): string[] {
	const beforeLines = new Set(before.split("\n").filter(Boolean));
	return after
		.split("\n")
		.filter(Boolean)
		.filter((line) => !beforeLines.has(line));
}

export function formatWorkingTreeLeak(lines: string[]): string {
	return lines.join("\n");
}
