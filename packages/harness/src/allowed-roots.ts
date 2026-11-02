import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { isPathUnderRoot } from "./working-tree-guard.js";

const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/;
const TMPDIR_PREFIX = /^(?:\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/;

function realOrResolved(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
/** `~`, `$HOME` and `$TMPDIR` as this process sees them, then the absolute path. */
function expandRoot(raw: string): string {
	return raw.trim().replace(HOME_PREFIX, homedir()).replace(TMPDIR_PREFIX, tmpdir());
}
function overlaps(root: string, guarded: string): boolean {
	return isPathUnderRoot(guarded, root) || isPathUnderRoot(root, guarded);
}
/** Why a root would widen the boundary past what a test may grant, or undefined when it is fine. */
function refusal(root: string, guard: { protectedPaths: readonly string[]; sealHome: boolean }) {
	if (root === "/") return "it is the whole filesystem";
	for (const [name, path] of [
		["the temp folder, which holds sibling workspaces", tmpdir()],
		["the home folder", homedir()],
	] as const)
		if (isPathUnderRoot(path, root) || isPathUnderRoot(realOrResolved(path), root))
			return `it contains ${name}`;
	if (guard.protectedPaths.some((path) => overlaps(root, path)))
		return "it overlaps the caller checkout";
	if (guard.sealHome && isPathUnderRoot(root, homedir()))
		return "it is under the real home, which --verdict-grade seals";
	return undefined;
}
/**
 * The extra roots a test lets its agent read, expanded and checked before any host starts. A root
 * may not be, or contain, the filesystem, the temp folder or the home folder, may not overlap the
 * caller checkout, and under a sealed home may not sit in the real home.
 */
export function resolveAllowedRoots(
	roots: readonly string[],
	guard: { protectedPaths: readonly string[]; sealHome: boolean },
): string[] {
	return roots.map((raw) => {
		const expanded = expandRoot(raw);
		if (!isAbsolute(expanded))
			throw new Error(`Allowed root ${raw} must be absolute, or start with ~, $HOME or $TMPDIR`);
		const root = realOrResolved(expanded);
		const reason = refusal(root, guard);
		if (reason) throw new Error(`Allowed root ${raw} is refused: ${reason}`);
		return root;
	});
}
