import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Host-enforced filesystem limits for one agent or reviewer session. The workspace stays
 * readable (and writable unless read-only); the shared temp folder, which holds sibling
 * sealed workspaces, and every protected path (the caller checkout) are denied.
 */
export interface HostIsolation {
	cwd: string;
	readOnly: boolean;
	protectedPaths: readonly string[];
	networkAccess?: boolean;
	/** Claude only: let sandboxed commands create Unix sockets, which headless Chrome needs. */
	allowUnixSockets?: boolean;
}

/**
 * Node resolves a script's real path by `lstat`-ing every parent directory, and the sealed
 * workspace's parents (the denied temp folder) cannot be stat-ed. Preserving symlinks skips that
 * walk, so `node script.mjs` runs inside the workspace without widening the sandbox. It also
 * breaks package-manager CLIs reached through a bin symlink; `writeNodeCliShims` shims those.
 */
const WHITESPACE = /\s+/;
export const SANDBOX_NODE_OPTIONS = ["--preserve-symlinks", "--preserve-symlinks-main"];

/** `NODE_OPTIONS` for commands run inside a sealed workspace, keeping any existing options. */
export function sandboxNodeOptions(existing?: string): string {
	const current = (existing ?? "").split(WHITESPACE).filter(Boolean);
	return [...current, ...SANDBOX_NODE_OPTIONS.filter((flag) => !current.includes(flag))].join(" ");
}

/**
 * Package-manager CLIs that install as a bin symlink to a JavaScript entry. With
 * `--preserve-symlinks-main` Node resolves that entry's relative imports from the symlink's
 * folder (`/opt/homebrew/bin/../lib/cli.js`), so `npm` and `npx` fail inside a sealed workspace.
 */
const SYMLINKED_NODE_CLIS = ["npm", "npx", "pnpm", "pnpx", "yarn", "yarnpkg", "corepack"];

function onPath(name: string, dirs: readonly string[]): string | null {
	for (const dir of dirs) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

const NODE_SCRIPT_EXTENSION = /\.[cm]?js$/;
const NODE_SHEBANG = /^#!.*\bnode\b/;

function isNodeScript(path: string): boolean {
	if (NODE_SCRIPT_EXTENSION.test(path)) return true;
	try {
		return NODE_SHEBANG.test(readFileSync(path, "utf8").slice(0, 128));
	} catch {
		return false;
	}
}

const SINGLE_QUOTE = /'/g;

function shellQuote(value: string): string {
	return `'${value.replace(SINGLE_QUOTE, "'\\''")}'`;
}

/** The symlinked Node CLI's real entry, or null when it needs no shim. */
function symlinkedNodeEntry(candidate: string): string | null {
	if (!lstatSync(candidate).isSymbolicLink()) return null;
	const entry = realpathSync(candidate);
	return isNodeScript(entry) ? entry : null;
}

/**
 * Write shims that start each symlinked package-manager CLI from its real path, and return
 * their folder. The shims live in the workspace's own `.git`, the one folder the sandbox lets
 * commands read that snapshots and diffs skip. Null when there is nothing to shim: no `.git`,
 * no `node` on `PATH`, or no symlinked CLI.
 */
function writeNodeCliShims(cwd: string, path: string): string | null {
	const dirs = path.split(delimiter).filter(Boolean);
	const nodeBin = onPath("node", dirs);
	if (!(existsSync(join(cwd, ".git")) && nodeBin)) return null;
	const node = realpathSync(nodeBin);
	const shimDir = join(cwd, ".git", "agent-harness", "bin");
	let written = 0;
	for (const name of SYMLINKED_NODE_CLIS) {
		const candidate = onPath(name, dirs);
		const entry = candidate ? symlinkedNodeEntry(candidate) : null;
		if (!entry) continue;
		mkdirSync(shimDir, { recursive: true });
		writeFileSync(
			join(shimDir, name),
			`#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(entry)} "$@"\n`,
			{ mode: 0o755 },
		);
		written++;
	}
	return written > 0 ? shimDir : null;
}

/** Codex: the `PATH` sealed commands get with the shims first, or null when nothing needs one. */
export function prepareSandboxPath(cwd: string, path = process.env.PATH ?? ""): string | null {
	const shimDir = writeNodeCliShims(cwd, path);
	return shimDir ? [shimDir, ...path.split(delimiter).filter(Boolean)].join(delimiter) : null;
}

/**
 * Claude: a `CLAUDE_ENV_FILE` script that puts the shims first. Claude Code restores `PATH`
 * from its login-shell snapshot, so neither the spawn environment nor settings `env` can set
 * it; the env file is sourced before each Bash command, after the snapshot. Null when nothing
 * needs a shim.
 */
export function prepareClaudeEnvFile(cwd: string, path = process.env.PATH ?? ""): string | null {
	const shimDir = writeNodeCliShims(cwd, path);
	if (!shimDir) return null;
	const envFile = join(cwd, ".git", "agent-harness", "claude-env.sh");
	writeFileSync(envFile, `export PATH=${shellQuote(shimDir)}:"$PATH"\n`);
	return envFile;
}

/** Codex permission profile name installed for every harness run. */
export const CODEX_PERMISSION_PROFILE = "agent_test";

/** TOML basic string literal. */
export function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function uniquePaths(paths: readonly string[]): string[] {
	const expanded = paths.flatMap((path) => {
		try {
			return [path, realpathSync(path)];
		} catch {
			return [path];
		}
	});
	return [...new Set(expanded)];
}

/**
 * `-c` overrides that select a Codex permission profile. Profiles replace `--sandbox`:
 * Codex ignores `default_permissions` when a legacy sandbox mode is also set.
 */
export function codexPermissionArgs(isolation: HostIsolation): string[] {
	const profile = `permissions.${CODEX_PERMISSION_PROFILE}`;
	const workspaceAccess = isolation.readOnly ? "read" : "write";
	const denied = uniquePaths(isolation.protectedPaths).map((path) => `${tomlString(path)}="deny"`);
	const filesystem = [
		'":tmpdir"="deny"',
		'":slash_tmp"="deny"',
		...denied,
		// Codex keeps `.git` read-only inside writable roots; agents must be able to commit in
		// their own throwaway repository.
		`":workspace_roots"={"."="${workspaceAccess}"${isolation.readOnly ? "" : ',".git"="write"'}}`,
	];
	const args = [
		"-c",
		`default_permissions="${CODEX_PERMISSION_PROFILE}"`,
		"-c",
		`${profile}.extends="${isolation.readOnly ? ":read-only" : ":workspace"}"`,
		"-c",
		`${profile}.filesystem={${filesystem.join(",")}}`,
	];
	if (!isolation.readOnly && isolation.networkAccess === true)
		args.push("-c", `${profile}.network.enabled=true`);
	return args;
}

/**
 * `--settings` JSON for Claude Code. The Bash sandbox blocks shell reads; permission
 * rules block Read/Grep/Glob outside the working directory and inside protected paths.
 */
export function claudeIsolationSettings(isolation: HostIsolation): string {
	const protectedPaths = uniquePaths(isolation.protectedPaths);
	return JSON.stringify({
		sandbox: {
			enabled: true,
			failIfUnavailable: true,
			allowUnsandboxedCommands: false,
			// On Linux the sandbox's seccomp filter blocks Unix socket creation, which kills
			// Chrome at startup. Opting in drops only that filter; the filesystem limits stay.
			...(isolation.allowUnixSockets === true ? { network: { allowAllUnixSockets: true } } : {}),
			filesystem: {
				denyRead: [...protectedPaths, ...uniquePaths([tmpdir()])],
				allowRead: uniquePaths([isolation.cwd]),
			},
		},
		env: { NODE_OPTIONS: sandboxNodeOptions() },
		permissions: {
			blockReadsOutsideWorkingDirectories: true,
			deny: protectedPaths.map((path) => `Read(/${path}/**)`),
		},
	});
}
