import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentTrace } from "./types.js";
import { isPathUnderRoot, porcelainPathFromStatusLine } from "./working-tree-guard.js";

const EDIT_TOOL_PATTERN = /write|edit|strreplace|apply_patch|search_replace|delete/i;

function pathsFromToolArgs(args: Record<string, unknown>): string[] {
	const paths: string[] = [];
	for (const key of ["path", "file_path", "filePath", "target_file", "uri"]) {
		const value = args[key];
		if (typeof value === "string") {
			paths.push(value);
		}
	}
	return paths;
}

/** Paths touched by a unified diff (b/ side). */
export function parseUnifiedDiffPaths(patchText: string): string[] {
	const paths = new Set<string>();
	for (const match of patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
		const right = match[2]?.trim();
		const left = match[1]?.trim();
		if (right) {
			paths.add(right);
		} else if (left) {
			paths.add(left);
		}
	}
	for (const match of patchText.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
		const path = match[1]?.trim();
		if (path && path !== "/dev/null") {
			paths.add(path);
		}
	}
	return [...paths];
}

export async function loadUnifiedDiffPaths(patchPath: string): Promise<string[]> {
	const text = await readFile(patchPath, "utf8");
	return parseUnifiedDiffPaths(text);
}

/** File edit tool calls that target the caller checkout outside the isolated worktree. */
export function traceEditsOutsideWorktree(
	trace: AgentTrace,
	worktreeRoot: string,
	callerRoot: string,
): string[] {
	const absWorktree = resolve(worktreeRoot);
	const absCaller = resolve(callerRoot);
	const outside = new Set<string>();

	for (const call of trace.toolCalls) {
		if (!EDIT_TOOL_PATTERN.test(call.name)) {
			continue;
		}
		const args = call.args ?? {};
		for (const rawPath of pathsFromToolArgs(args)) {
			const normalized = rawPath.replace(/^file:\/\//, "");
			const absPath = resolve(absCaller, normalized.replace(/^\.\/+/, ""));
			if (isPathUnderRoot(absPath, absCaller) && !isPathUnderRoot(absPath, absWorktree)) {
				outside.add(normalized);
			}
		}
		const serialized = JSON.stringify(args);
		for (const match of serialized.matchAll(/"([^"]+\.(?:tsx?|jsx?|md|json|py|rs|go))"/gi)) {
			const candidate = match[1];
			if (!candidate) {
				continue;
			}
			const absPath = resolve(absCaller, candidate.replace(/^\.\/+/, ""));
			if (isPathUnderRoot(absPath, absCaller) && !isPathUnderRoot(absPath, absWorktree)) {
				outside.add(candidate);
			}
		}
	}

	return [...outside];
}

function pathMatchesSeedTarget(path: string, seedPaths: string[]): boolean {
	return seedPaths.some((seedPath) => path === seedPath || path.endsWith(`/${seedPath}`));
}

function pathMatchesOutsideEdit(path: string, outsideEdits: string[]): boolean {
	return outsideEdits.some(
		(editPath) =>
			path === editPath ||
			path.endsWith(`/${editPath}`) ||
			editPath.endsWith(path) ||
			editPath.includes(path),
	);
}

/**
 * Split porcelain leak lines into seed collateral (index/staging noise on seed targets)
 * vs real caller-tree agent leaks.
 */
export function partitionSeedCollateralLeaks(
	leaked: string[],
	seedPaths: string[],
	outsideEdits: string[],
): { collateral: string[]; agentLeaks: string[] } {
	if (seedPaths.length === 0) {
		return { collateral: [], agentLeaks: leaked };
	}

	const collateral: string[] = [];
	const agentLeaks: string[] = [];

	for (const line of leaked) {
		const path = porcelainPathFromStatusLine(line);
		if (!path) {
			agentLeaks.push(line);
			continue;
		}
		const isSeedTarget = pathMatchesSeedTarget(path, seedPaths);
		const editedOutside = pathMatchesOutsideEdit(path, outsideEdits);
		if (isSeedTarget && !editedOutside) {
			collateral.push(line);
		} else {
			agentLeaks.push(line);
		}
	}

	return { collateral, agentLeaks };
}

export function porcelainPathsFromLines(lines: string[]): string[] {
	return lines.map(porcelainPathFromStatusLine).filter((path) => path.length > 0);
}
