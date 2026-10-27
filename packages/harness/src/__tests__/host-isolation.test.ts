import { expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import {
	claudeIsolationSettings,
	codexPermissionArgs,
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
