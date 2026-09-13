import { describe, expect, it } from "bun:test";

import { buildOpenaiExecArgs, buildOpenaiMcpOverride } from "../openai-run.js";

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
		expect(args.at(-1)).toBe("Say hello.");
	});

	it("uses a read-only sandbox for classifiers", () => {
		const args = buildOpenaiExecArgs({
			prompt: "yes or no",
			cwd: "/tmp/seal",
			sandbox: "read-only",
		});
		expect(args).toContain("read-only");
		expect(args).toContain("approval_policy=never");
		expect(args).not.toContain("--approve-for-me");
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
