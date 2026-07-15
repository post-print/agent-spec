import type { AgentTrace } from "@post-print/agent-harness";
import { describe, expect, it } from "vitest";

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

	it("checks mustInclude across shell commands", () => {
		const failures = assertRubric(sampleTrace, { must: ["validate:changed"] });
		expect(failures).toHaveLength(0);
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
		const failures = assertRubric(trace, { tier: "medium", handsOnRouting: true });
		expect(failures).toHaveLength(0);
	});

	it("fails hands-on tier when announce missing", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "Here are some options to consider." }],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { tier: "medium", handsOnRouting: true });
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
		const failures = assertRubric(trace, { routingBlock: true, must: ["Tier"] });
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
		const failures = assertRubric(trace, { routingBlock: true, must: ["Tier", "Signals"] });
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

	it("accepts applied skill prose in full catalog mode", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "grill before implement.\n\nBranch 1 — …" }],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		const failures = assertRubric(trace, { mustInvokeSkill: ["grill"] }, { skillsMode: "full" });
		expect(failures).toHaveLength(0);
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
});
