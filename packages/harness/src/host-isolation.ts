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
		`":workspace_roots"={"."="${workspaceAccess}"}`,
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
			filesystem: {
				denyRead: [...protectedPaths, ...uniquePaths([tmpdir()])],
				allowRead: uniquePaths([isolation.cwd]),
			},
		},
		permissions: {
			blockReadsOutsideWorkingDirectories: true,
			deny: protectedPaths.map((path) => `Read(/${path}/**)`),
		},
	});
}
