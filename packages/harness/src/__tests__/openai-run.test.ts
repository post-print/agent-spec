import { describe, expect, it } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildOpenaiExecArgs, buildOpenaiMcpOverride, createOpenaiRunHome } from "../openai-run.js";

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

describe("buildOpenaiExecArgs", () => {
	it("pins the Codex sandbox to the sealed workspace", () => {
		const args = buildOpenaiExecArgs({
			prompt: "Say hello.",
			cwd: "/tmp/agent-harness-seal-test",
		});
		expect(args.slice(0, 9)).toEqual([
			"exec",
			"--json",
			"--sandbox",
			"workspace-write",
			"--cd",
			"/tmp/agent-harness-seal-test",
			"--ignore-user-config",
			"-c",
			"approval_policy=never",
		]);
		expect(args).not.toContain("--approve-for-me");
		expect(args).not.toContain("sandbox_workspace_write.network_access=true");
		expect(args.at(-1)).toBe("Say hello.");
	});

	it("enables network only when a workspace-write run opts in", () => {
		const args = buildOpenaiExecArgs({
			prompt: "Install a package.",
			cwd: "/tmp/agent-harness-seal-test",
			networkAccess: true,
		});
		expect(args).toContain("workspace-write");
		expect(args).toContain("sandbox_workspace_write.network_access=true");
	});

	it("omits --ignore-user-config when user skills are allowed", () => {
		const args = buildOpenaiExecArgs({
			prompt: "Say hello.",
			cwd: "/tmp/agent-harness-seal-test",
			allowUserSkills: true,
		});
		expect(args).not.toContain("--ignore-user-config");
	});

	it("uses a read-only sandbox for classifiers", () => {
		const args = buildOpenaiExecArgs({
			prompt: "yes or no",
			cwd: "/tmp/seal",
			sandbox: "read-only",
		});
		expect(args).toContain("read-only");
		expect(args).toContain("approval_policy=never");
		expect(args).not.toContain("sandbox_workspace_write.network_access=true");
		expect(args).not.toContain("--approve-for-me");
	});

	it("does not enable network for a read-only classifier", () => {
		const args = buildOpenaiExecArgs({
			prompt: "yes or no",
			cwd: "/tmp/seal",
			sandbox: "read-only",
			networkAccess: true,
		});
		expect(args).not.toContain("sandbox_workspace_write.network_access=true");
	});

	it("passes stdio MCP servers as -c overrides", () => {
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
});

describe("buildOpenaiMcpOverride", () => {
	it("quotes paths that contain spaces", () => {
		expect(
			buildOpenaiMcpOverride("echo", {
				command: "node",
				args: ["/tmp/my reports/echo.mjs"],
			}),
		).toBe(
			'mcp_servers.echo={command="node",args=["/tmp/my reports/echo.mjs"],default_tools_approval_mode="approve"}',
		);
	});
});
