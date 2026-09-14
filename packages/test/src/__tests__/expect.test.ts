import { describe, expect, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";

import { assertRubric, expectTrace } from "../expect.js";

const sampleTrace: AgentTrace = {
	messages: [
		{
			role: "assistant",
			content: "## Review synthesis\n\n**Depth:** Full (escalated)",
		},
	],
	toolCalls: [],
	shellCommands: ["bun run validate:changed tspackages/foo"],
	prBody: "## Routing\n- **Tier:** medium",
	artifacts: {},
	routing: { tier: "medium", signals: ["fuzzy intent"] },
};

describe("expectTrace", () => {
	it("passes tier and routing block", () => {
		const failures = assertRubric(sampleTrace, {
			tier: "medium",
			routingBlock: true,
			mustRun: ["validate:changed"],
		});
		expect(failures).toHaveLength(0);
	});

	it("fails wrong tier", () => {
		expect(expectTrace(sampleTrace).toHaveTier("high").ok).toBe(false);
	});

	it("checks review depth in synthesis output", () => {
		const failures = assertRubric(sampleTrace, { reviewDepth: "full" });
		expect(failures).toHaveLength(0);
	});

	it("checks Review header depth for code-review skill shape", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "Review · staged · Standard · post-login-redirect\n\n## Review synthesis",
				},
			],
			toolCalls: [],
			shellCommands: [],
			skillsInvoked: ["code-review"],
			artifacts: {},
		};
		const failures = assertRubric(
			trace,
			{ reviewDepth: "standard", mustInvokeSkill: ["code-review"] },
			{ skillsMode: "full" },
		);
		expect(failures).toHaveLength(0);
	});

	it("does not treat a shell command as must evidence", () => {
		const failures = assertRubric(sampleTrace, { must: ["validate:changed"] });
		expect(failures).toHaveLength(1);
		expect(failures[0]?.matcher).toBe("mustInclude");
	});

	it("fails must when the required string is only in a Read result", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "I read AGENTS.md and will follow it.",
				},
			],
			toolCalls: [
				{
					name: "Read",
					args: { path: "AGENTS.md" },
					result: "VALIDATE_CMD=skeleton validate changed\nOther tokens.",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, {
			must: ["VALIDATE_CMD=skeleton validate changed"],
		});
		expect(failures).toHaveLength(1);
		expect(failures[0]?.matcher).toBe("mustInclude");
		expect(failures[0]?.category).toBe("rubric_miss");
	});

	it("does not treat a Read tool result as mustNot evidence", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "agent-test-judge-fact-2e7b is the only shipped token.",
				},
			],
			toolCalls: [
				{
					name: "Read",
					args: { path: "note.md" },
					result: "Confirmed fact: agent-test-judge-fact-2e7b\nRumor: agent-test-judge-rumor-9aa1",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		expect(
			assertRubric(trace, {
				must: ["agent-test-judge-fact-2e7b"],
				mustNot: ["agent-test-judge-rumor-9aa1"],
			}),
		).toHaveLength(0);
	});

	it("checks mustNot across shell commands", () => {
		const trace: AgentTrace = {
			...sampleTrace,
			messages: [],
			shellCommands: ["dispatch council review"],
		};
		const failures = assertRubric(trace, { mustNot: ["council"] });
		expect(failures).toHaveLength(1);
		expect(failures[0]?.matcher).toBe("mustNotInclude");
		expect(failures[0]?.category).toBe("rubric_miss");
		expect(failures[0]?.evidence).toContain("dispatch council review");
	});

	it("attaches evidence for missing mustInclude text", () => {
		const failures = assertRubric(sampleTrace, { must: ["definitely-missing-token"] });
		expect(failures[0]?.category).toBe("rubric_miss");
		expect(failures[0]?.matcher).toBe("mustInclude");
	});

	it("attaches shellCommands evidence for missing mustRun", () => {
		const failures = assertRubric(sampleTrace, { mustRun: ["npm test"] });
		expect(failures[0]?.category).toBe("rubric_miss");
		expect(failures[0]?.evidence).toContain("shellCommands=");
	});

	it("passes hands-on tier inferred from one-line announce", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "Routing: Medium — stating branches before any edits.",
				},
			],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, {
			tier: "medium",
			handsOnRouting: true,
		});
		expect(failures).toHaveLength(0);
	});

	it("fails hands-on tier when announce missing", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "Here are some options to consider." }],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, {
			tier: "medium",
			handsOnRouting: true,
		});
		expect(failures.some((f) => f.matcher === "toHaveHandsOnTier")).toBe(true);
	});

	it("fails when tier announce comes after tool calls", () => {
		const trace: AgentTrace = {
			messages: [
				{ role: "assistant", content: "Reading the file…" },
				{ role: "assistant", content: "Routing: Low — done." },
			],
			toolCalls: [{ name: "Read", args: { path: "apps/client/src/foo.ts" } }],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "Reading the file…",
		};
		const failures = assertRubric(trace, { tier: "low", handsOnRouting: true });
		expect(failures.some((f) => f.matcher === "toHaveHandsOnTierBeforeTools")).toBe(true);
	});

	it("passes when tier announce precedes tool calls", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "Routing: Low — single-file guard.\n\nReading the file…",
				},
			],
			toolCalls: [{ name: "Read", args: { path: "apps/client/src/foo.ts" } }],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { tier: "low", handsOnRouting: true });
		expect(failures).toHaveLength(0);
	});

	it("fails when ## Routing appears only after tool calls", () => {
		const trace: AgentTrace = {
			messages: [
				{ role: "assistant", content: "Exploring the score panel…" },
				{
					role: "assistant",
					content: "## Routing\n- **Tier:** Medium\n- **Signals:** planning",
				},
			],
			toolCalls: [{ name: "Glob", args: { globPattern: "apps/client/**" } }],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "Exploring the score panel…",
		};
		const failures = assertRubric(trace, {
			routingBlock: true,
			must: ["Tier"],
		});
		expect(failures.some((f) => f.matcher === "toHaveRoutingBlockBeforeTools")).toBe(true);
	});

	it("passes when ## Routing precedes tool calls", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "## Routing\n- **Tier:** Medium\n- **Signals:** score panel UX\n\nExploring…",
				},
			],
			toolCalls: [{ name: "Glob", args: { globPattern: "apps/client/**" } }],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, {
			routingBlock: true,
			must: ["Tier", "Signals"],
		});
		expect(failures).toHaveLength(0);
	});

	it("checks mustInvokeSkill from tool calls", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "Invoking grill." }],
			toolCalls: [{ name: "Read", args: { path: ".claude/skills/grill/SKILL.md" } }],
			shellCommands: [],
			skillsInvoked: ["grill"],
			artifacts: {},
		};
		const failures = assertRubric(trace, { mustInvokeSkill: ["grill"] });
		expect(failures).toHaveLength(0);
	});

	it("checks mustInvokeSkill from a Cursor .agents skill path", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "Read", args: { path: ".agents/skills/probe/SKILL.md" } }],
			shellCommands: [],
			skillsInvoked: ["probe"],
			artifacts: {},
		};
		expect(assertRubric(trace, { mustInvokeSkill: ["probe"] })).toHaveLength(0);
	});

	it("fails mustNotInvokeSkill when skill read present", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "read", args: { path: ".claude/skills/grill/SKILL.md" } }],
			shellCommands: [],
			skillsInvoked: ["grill"],
			artifacts: {},
		};
		const failures = assertRubric(trace, { mustNotInvokeSkill: ["grill"] });
		expect(failures.some((f) => f.matcher === "toHaveNotInvokedSkill")).toBe(true);
	});

	it("rejects skill-name prose without a skill file read", () => {
		const trace: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "grill before implement.\n\nBranch 1 — …",
				},
			],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { mustInvokeSkill: ["grill"] }, { skillsMode: "full" });
		expect(failures.some((f) => f.matcher === "toHaveInvokedSkill")).toBe(true);
	});

	it("matches review depth across token-chunked assistant messages", () => {
		const trace: AgentTrace = {
			messages: [
				{ role: "assistant", content: "Review · pr · Th" },
				{ role: "assistant", content: "orough · score-panel" },
				{ role: "assistant", content: "\n\n**Depth:** Th" },
				{ role: "assistant", content: "orough" },
			],
			toolCalls: [],
			shellCommands: [],
			skillsInvoked: ["code-review"],
			artifacts: {},
		};
		expect(assertRubric(trace, { reviewDepth: "thorough" })).toHaveLength(0);
	});

	it("matches Write against a Cursor edit call", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "edit", args: { path: "agent-test-write-out.txt" } }],
			shellCommands: [],
			artifacts: {},
		};
		expect(assertRubric(trace, { mustCallTool: ["Write"] })).toHaveLength(0);
	});

	it("matches an MCP tool name that lives in args", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "CallMcpTool",
					args: { server: "echo", toolName: "echo", text: "agent-test-mcp-echo-ok-1a7c" },
					result: "agent-test-mcp-echo-ok-1a7c",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		expect(
			assertRubric(trace, { mustCallTool: ["echo:agent-test-mcp-echo-ok-1a7c"] }),
		).toHaveLength(0);
	});

	it("checks mustCallTool by name and arg fragment", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "mcp_echo_echo",
					args: { text: "mcp echo ok" },
					result: "mcp echo ok",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		expect(
			assertRubric(trace, {
				mustCallTool: ["echo", "echo:mcp echo ok"],
				mustNotCallTool: ["shell"],
			}),
		).toHaveLength(0);
	});

	it("does not treat an MCP tool result as must evidence", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "done" }],
			toolCalls: [
				{
					name: "echo",
					args: { text: "ping" },
					result: "mcp echo ok",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { must: ["mcp echo ok"] });
		expect(failures).toHaveLength(1);
		expect(failures[0]?.matcher).toBe("mustInclude");
	});

	it("checks mustCallTool when the fragment is only in the tool result", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "echo",
					args: { text: "ping" },
					result: "mcp echo ok",
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		expect(assertRubric(trace, { mustCallTool: ["echo:mcp echo ok"] })).toHaveLength(0);
	});

	it("fails mustCallTool when args do not match", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "echo", args: { text: "other" } }],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, {
			mustCallTool: ["echo:mcp echo ok"],
		});
		expect(failures.some((f) => f.matcher === "toHaveCalledTool")).toBe(true);
	});

	it("fails mustNotCallTool when tool was called", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "echo", args: { text: "hi" } }],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { mustNotCallTool: ["echo"] });
		expect(failures.some((f) => f.matcher === "toHaveNotCalledTool")).toBe(true);
	});

	it("passes mustReadPath when Read args contain the fragment", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "Read", args: { path: ".skeleton/registry.md" } }],
			shellCommands: [],
			artifacts: {},
		};
		expect(assertRubric(trace, { mustReadPath: [".skeleton/registry"] })).toHaveLength(0);
	});

	it("passes mustReadPath when Codex reads the path through Shell", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "Shell",
					args: { command: "cat agent-suites/tools/fixtures/needle.txt" },
				},
			],
			shellCommands: ["cat agent-suites/tools/fixtures/needle.txt"],
			artifacts: {},
		};
		expect(
			assertRubric(trace, { mustReadPath: ["agent-suites/tools/fixtures/needle.txt"] }),
		).toHaveLength(0);
	});

	it("fails mustNotReadPath only when a successful Read returned content for the path", () => {
		const miss: AgentTrace = {
			messages: [],
			toolCalls: [{ name: "Read", args: { path: "invented/path.ts" } }],
			shellCommands: [],
			artifacts: {},
		};
		expect(assertRubric(miss, { mustNotReadPath: ["invented/"] })).toHaveLength(0);

		const errorResult: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "Read",
					args: { path: "diagnose/SKILL.md" },
					result: JSON.stringify({ status: "error", value: "ENOENT" }),
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		expect(assertRubric(errorResult, { mustNotReadPath: ["diagnose/SKILL.md"] })).toHaveLength(0);

		const hit: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "Read",
					args: { path: "diagnose/SKILL.md" },
					result: JSON.stringify({
						status: "success",
						value: { content: "# Diagnose\n\nEntry gate — no loop\n" },
					}),
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(hit, { mustNotReadPath: ["diagnose/SKILL.md"] });
		expect(failures.some((f) => f.matcher === "toHaveNotReadPath")).toBe(true);
	});
});
