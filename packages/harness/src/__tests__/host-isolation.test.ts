import { afterEach, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeIsolationSettings,
	codexPermissionArgs,
	prepareSandboxPath,
	sandboxNodeOptions,
} from "../host-isolation.js";

it("claudeIsolationSettings › sandboxes Bash and blocks file tools outside the workspace", () => {
	const settings = JSON.parse(
		claudeIsolationSettings({
			cwd: "/tmp/seal/workspace",
			readOnly: false,
			protectedPaths: ["/repo/checkout"],
		}),
	);
	expect(settings.sandbox).toMatchObject({
		enabled: true,
		failIfUnavailable: true,
		allowUnsandboxedCommands: false,
	});
	expect(settings.sandbox.filesystem.denyRead).toContain("/repo/checkout");
	expect(settings.sandbox.filesystem.denyRead).toContain(realpathSync(tmpdir()));
	expect(settings.sandbox.filesystem.allowRead).toContain("/tmp/seal/workspace");
	expect(settings.permissions).toEqual({
		blockReadsOutsideWorkingDirectories: true,
		deny: ["Read(//repo/checkout/**)"],
	});
});

it("codexPermissionArgs › keeps the temp folder denied and lets agents commit in their workspace", () => {
	const args = codexPermissionArgs({
		cwd: "/tmp/seal/workspace",
		readOnly: false,
		protectedPaths: ["/repo/checkout"],
	});
	const filesystem = args.find((arg) => arg.includes(".filesystem=")) ?? "";
	expect(filesystem).toContain('":tmpdir"="deny"');
	expect(filesystem).toContain('"/repo/checkout"="deny"');
	expect(filesystem).toContain('":workspace_roots"={"."="write",".git"="write"}');
});

it("codexPermissionArgs › read-only reviewers get no .git write", () => {
	const args = codexPermissionArgs({
		cwd: "/tmp/seal/workspace",
		readOnly: true,
		protectedPaths: [],
	});
	const filesystem = args.find((arg) => arg.includes(".filesystem=")) ?? "";
	expect(filesystem).toContain('":workspace_roots"={"."="read"}');
	expect(filesystem).not.toContain(".git");
});

it("sandboxNodeOptions › adds the symlink flags once and keeps existing options", () => {
	expect(sandboxNodeOptions()).toBe("--preserve-symlinks --preserve-symlinks-main");
	expect(sandboxNodeOptions("--max-old-space-size=4096 --preserve-symlinks")).toBe(
		"--max-old-space-size=4096 --preserve-symlinks --preserve-symlinks-main",
	);
});

it("claudeIsolationSettings › passes the sandbox Node options to tool commands", () => {
	const settings = JSON.parse(
		claudeIsolationSettings({ cwd: "/tmp/seal/workspace", readOnly: false, protectedPaths: [] }),
	);
	expect(settings.env).toEqual({ NODE_OPTIONS: "--preserve-symlinks --preserve-symlinks-main" });
});

it("claudeIsolationSettings › allows Unix sockets only when asked", () => {
	const settings = (allowUnixSockets?: boolean) =>
		JSON.parse(
			claudeIsolationSettings({
				cwd: "/tmp/seal/workspace",
				readOnly: false,
				protectedPaths: [],
				allowUnixSockets,
			}),
		).sandbox;
	expect(settings().network).toBeUndefined();
	expect(settings(true).network).toEqual({ allowAllUnixSockets: true });
	expect(settings(true).filesystem.allowRead).toContain("/tmp/seal/workspace");
});

const sandboxPathRoots: string[] = [];

/** A fake toolchain: a native `node`, an npm-style symlinked `npx`, and a plain script. */
function setupToolchain(): { workspace: string; bin: string } {
	const root = mkdtempSync(join(tmpdir(), "sandbox-path-"));
	sandboxPathRoots.push(root);
	const bin = join(root, "bin");
	const lib = join(root, "lib", "npm", "bin");
	const workspace = join(root, "workspace");
	mkdirSync(bin, { recursive: true });
	mkdirSync(lib, { recursive: true });
	mkdirSync(join(workspace, ".git"), { recursive: true });
	writeFileSync(join(bin, "node"), "#!/bin/sh\n", { mode: 0o755 });
	writeFileSync(join(lib, "npx-cli.js"), "#!/usr/bin/env node\n");
	symlinkSync(join(lib, "npx-cli.js"), join(bin, "npx"));
	writeFileSync(join(bin, "yarn"), "#!/bin/sh\n", { mode: 0o755 });
	return { workspace, bin };
}

describe("prepareSandboxPath", () => {
	afterEach(() => {
		for (const root of sandboxPathRoots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	it("shims symlinked Node CLIs from their real path, first on PATH", () => {
		const { workspace, bin } = setupToolchain();
		const shimDir = join(workspace, ".git", "agent-harness", "bin");
		expect(prepareSandboxPath(workspace, `${bin}:/usr/bin`)).toBe(`${shimDir}:${bin}:/usr/bin`);
		const shim = readFileSync(join(shimDir, "npx"), "utf8");
		expect(shim).toBe(
			`#!/bin/sh\nexec '${realpathSync(join(bin, "node"))}' '${realpathSync(join(bin, "npx"))}' "$@"\n`,
		);
		expect(existsSync(join(shimDir, "yarn"))).toBe(false);
	});

	it("is null when there is nothing to shim", () => {
		const { workspace, bin } = setupToolchain();
		rmSync(join(bin, "npx"));
		expect(prepareSandboxPath(workspace, bin)).toBeNull();
		expect(prepareSandboxPath(join(workspace, "missing"), bin)).toBeNull();
		expect(prepareSandboxPath(workspace, "/nonexistent")).toBeNull();
	});

	it("reaches Claude tool commands through the settings env", () => {
		const settings = JSON.parse(
			claudeIsolationSettings({
				cwd: "/tmp/seal/workspace",
				readOnly: false,
				protectedPaths: [],
				path: "/tmp/seal/workspace/.git/agent-harness/bin:/usr/bin",
			}),
		);
		expect(settings.env.PATH).toBe("/tmp/seal/workspace/.git/agent-harness/bin:/usr/bin");
	});
});
