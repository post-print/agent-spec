import { describe, expect, it } from "bun:test";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildOpenaiExecArgs,
	buildOpenaiMcpOverride,
	createOpenaiRunHome,
	recoverOpenaiRunHomes,
} from "../openai-run.js";

it("creates an auth-only home for an isolated Codex run", async () => {
	const realHome = await mkdtemp(join(tmpdir(), "openai-real-home-"));
	const realCodexHome = join(realHome, ".codex");
	await mkdir(join(realHome, ".agents/skills/private"), { recursive: true });
	await mkdir(realCodexHome, { recursive: true });
	await writeFile(join(realHome, ".agents/skills/private/SKILL.md"), "private", "utf8");
	await writeFile(join(realCodexHome, "AGENTS.md"), "private instructions", "utf8");
	await writeFile(join(realCodexHome, "auth.json"), "login", "utf8");
	try {
		const isolated = await createOpenaiRunHome({ realHome, realCodexHome });
		try {
			expect(await readFile(join(isolated.codexHome, "auth.json"), "utf8")).toBe("login");
			await expect(
				access(join(isolated.home, ".agents/skills/private/SKILL.md")),
			).rejects.toThrow();
			await expect(access(join(isolated.codexHome, "AGENTS.md"))).rejects.toThrow();
		} finally {
			await isolated.cleanup();
		}
	} finally {
		await rm(realHome, { recursive: true, force: true });
	}
});

it("buildOpenaiExecArgs › pins Codex to the sealed workspace with a permission profile", () => {
	const args = buildOpenaiExecArgs({
		prompt: "Say hello.",
		cwd: "/tmp/agent-harness-seal-test",
		protectedPaths: ["/repo/checkout"],
	});
	expect(args.slice(0, 9)).toEqual([
		"exec",
		"--json",
		"--cd",
		"/tmp/agent-harness-seal-test",
		"--ignore-user-config",
		"-c",
		"features.apps=false",
		"-c",
		"approval_policy=never",
	]);
	// Codex ignores default_permissions when a legacy --sandbox mode is also set.
	expect(args).not.toContain("--sandbox");
	expect(args).toContain('default_permissions="agent_test"');
	expect(args).toContain('permissions.agent_test.extends=":workspace"');
	const filesystem = args.find((arg) => arg.startsWith("permissions.agent_test.filesystem="));
	expect(filesystem).toContain('":tmpdir"="deny"');
	expect(filesystem).toContain('":slash_tmp"="deny"');
	expect(filesystem).toContain('"/repo/checkout"="deny"');
	expect(filesystem).toContain('":workspace_roots"={"."="write",".git"="write"}');
	expect(args).not.toContain("permissions.agent_test.network.enabled=true");
	expect(args).not.toContain("--approve-for-me");
	expect(args.at(-1)).toBe("Say hello.");
});

it("buildOpenaiExecArgs › enables network only when a writable run opts in", () => {
	const args = buildOpenaiExecArgs({
		prompt: "Install a package.",
		cwd: "/tmp/agent-harness-seal-test",
		networkAccess: true,
	});
	expect(args).toContain("permissions.agent_test.network.enabled=true");
});

it("buildOpenaiExecArgs › omits --ignore-user-config when user skills are allowed", () => {
	const args = buildOpenaiExecArgs({
		prompt: "Say hello.",
		cwd: "/tmp/agent-harness-seal-test",
		includeGlobalSkills: true,
	});
	expect(args).not.toContain("--ignore-user-config");
});

it("buildOpenaiExecArgs › gives reviewers a read-only profile without project instructions", () => {
	const args = buildOpenaiExecArgs({
		prompt: "yes or no",
		cwd: "/tmp/seal",
		sandbox: "read-only",
		networkAccess: true,
	});
	expect(args).toContain('permissions.agent_test.extends=":read-only"');
	expect(args.find((arg) => arg.startsWith("permissions.agent_test.filesystem="))).toContain(
		'":workspace_roots"={"."="read"}',
	);
	expect(args).toContain("project_doc_max_bytes=0");
	expect(args).toContain("--skip-git-repo-check");
	expect(args).toContain("approval_policy=never");
	expect(args).not.toContain("permissions.agent_test.network.enabled=true");
	expect(args).not.toContain("--sandbox");
});

it("buildOpenaiExecArgs › keeps project instructions and git checks for task runs", () => {
	const args = buildOpenaiExecArgs({ prompt: "Run task", cwd: "/tmp/workspace" });
	expect(args).not.toContain("--skip-git-repo-check");
	expect(args).not.toContain("project_doc_max_bytes=0");
});

it("buildOpenaiExecArgs › passes stdio MCP servers as -c overrides", () => {
	const args = buildOpenaiExecArgs({
		prompt: "Call echo.",
		cwd: "/tmp/seal",
		mcpServers: {
			echo: {
				command: "node",
				args: ["/tmp/seal/echo.mjs"],
				cwd: "/tmp/seal",
			},
		},
	});
	expect(args).toContain("-c");
	expect(args).toContain(
		'mcp_servers.echo={command="node",args=["/tmp/seal/echo.mjs"],cwd="/tmp/seal",default_tools_approval_mode="approve"}',
	);
	expect(args.at(-1)).toBe("Call echo.");
});

it("buildOpenaiMcpOverride › quotes paths that contain spaces", () => {
	expect(
		buildOpenaiMcpOverride("echo", {
			command: "node",
			args: ["/tmp/my reports/echo.mjs"],
		}),
	).toBe(
		'mcp_servers.echo={command="node",args=["/tmp/my reports/echo.mjs"],default_tools_approval_mode="approve"}',
	);
});

it("a sealed run cannot reach the account's connected apps", async () => {
	const { buildOpenaiExecArgs } = await import("../openai-run.js");
	const sealed = buildOpenaiExecArgs({ prompt: "hi", cwd: "/tmp/workspace" });
	expect(sealed.join(" ")).toContain("features.apps=false");
	const global = buildOpenaiExecArgs({
		prompt: "hi",
		cwd: "/tmp/workspace",
		includeGlobalSkills: true,
	});
	expect(global.join(" ")).not.toContain("features.apps=false");
});

describe("Codex home recovery", () => {
	const PREFIX = "agent-harness-openai-home-";
	const KIND = "agent-harness-openai-home";
	async function homeWithManifest(root: string, name: string, manifest: object | undefined) {
		const home = join(root, `${PREFIX}${name}`);
		await mkdir(join(home, ".codex"), { recursive: true });
		await writeFile(join(home, ".codex", "marker"), "fake");
		if (manifest) await writeFile(join(home, "owner.json"), JSON.stringify(manifest));
	}
	it("a run home names its owner on disk before it holds a login", async () => {
		const realHome = await mkdtemp(join(tmpdir(), "openai-home-owner-"));
		const realCodexHome = join(realHome, ".codex");
		await mkdir(realCodexHome);
		await writeFile(join(realCodexHome, "auth.json"), '{"fake":true}');
		const isolated = await createOpenaiRunHome({ realHome, realCodexHome });
		try {
			const manifest = JSON.parse(await readFile(join(isolated.home, "owner.json"), "utf8"));
			expect(manifest).toMatchObject({ version: 1, kind: KIND, owner: { pid: process.pid } });
		} finally {
			await isolated.cleanup();
			await rm(realHome, { recursive: true, force: true });
		}
	});
	it("removes only old homes of a provably dead owner", async () => {
		const root = await mkdtemp(join(tmpdir(), "openai-home-recovery-"));
		const dead = { version: 1, kind: KIND, owner: { pid: 999_999 } };
		const old = "2020-01-01T00:00:00Z";
		try {
			await homeWithManifest(root, "unowned", undefined);
			await homeWithManifest(root, "other-kind", { ...dead, kind: "x", createdAt: old });
			await homeWithManifest(root, "young", { ...dead, createdAt: new Date().toISOString() });
			await homeWithManifest(root, "live", {
				...dead,
				owner: { pid: process.pid },
				createdAt: old,
			});
			await homeWithManifest(root, "dead", { ...dead, createdAt: old });
			await recoverOpenaiRunHomes({ temporaryRoot: root });
			expect((await readdir(root)).sort()).toEqual(
				["live", "other-kind", "unowned", "young"].map((name) => `${PREFIX}${name}`),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
