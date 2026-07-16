import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve a path for identity checks; fall back to resolve() if realpath fails. */
export function resolveRealPath(path: string): string {
	try {
		return realpathSync(resolve(path));
	} catch {
		return resolve(path);
	}
}

/**
 * True when this module is the process entrypoint (including via npm bin symlinks).
 * Compares real paths so `node_modules/.bin/agent-test` matches `dist/cli.js`.
 */
export function isCliMain(argv1: string | undefined, entryPath: string): boolean {
	return argv1 !== undefined && resolveRealPath(argv1) === resolveRealPath(entryPath);
}
