import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

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
 * walk, so `node script.mjs` runs inside the workspace without widening the sandbox.
 */
const WHITESPACE = /\s+/;
export const SANDBOX_NODE_OPTIONS = ["--preserve-symlinks", "--preserve-symlinks-main"];

/** `NODE_OPTIONS` for commands run inside a sealed workspace, keeping any existing options. */
export function sandboxNodeOptions(existing?: string): string {
	const current = (existing ?? "").split(WHITESPACE).filter(Boolean);
	return [...current, ...SANDBOX_NODE_OPTIONS.filter((flag) => !current.includes(flag))].join(" ");
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
