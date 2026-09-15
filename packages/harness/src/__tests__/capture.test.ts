import { describe, expect, it } from "bun:test";

import {
	accumulateSdkEvent,
	assistantPrefixBeforeTools,
	buildTraceFromSdkMessages,
	createTraceAccumulator,
	enrichTrace,
	extractShellCommands,
	extractShellCommandsFromToolCalls,
	extractSkillsInvokedFromToolCalls,
	finalizeTraceAccumulator,
	handsOnTierBeforeTools,
	inferPrBodyFromText,
	inferReviewDepthFromText,
	inferRoutingFromText,
	resolvedTotalTokens,
	routingBlockBeforeTools,
} from "../capture.js";
import type { AgentTrace } from "../types.js";

describe("capture", () => {
	it("extracts validate commands from prose", () => {
		const cmds = extractShellCommands("Run bun run validate:changed apps/client");
		expect(cmds).toContain("bun run validate:changed");
	});

	it("extracts shell commands from tool call args", () => {
		const cmds = extractShellCommandsFromToolCalls([
			{
				name: "shell",
				args: {
					command: "bun run validate:changed apps/client/src/utils/post-login-redirect.ts",
				},
			},
		]);
		expect(cmds.some((cmd) => cmd.includes("validate:changed"))).toBe(true);
	});

	it("keeps a raw node command for mustRun", () => {
		const cmds = extractShellCommandsFromToolCalls([
			{
				name: "shell",
				args: {
					command: "node -e \"console.log('agent-test-depth-run-8b2c')\"",
				},
			},
		]);
		expect(cmds.some((cmd) => cmd.includes("agent-test-depth-run-8b2c"))).toBe(true);
	});

	it("extracts invoked skills from Read tool paths", () => {
		const skills = extractSkillsInvokedFromToolCalls([
			{
				name: "Read",
				args: { path: ".claude/skills/grill/SKILL.md" },
			},
			{
				name: "read",
				args: { path: ".claude/skills/code-review/references/modes.md" },
			},
			{
				name: "Read",
				args: { path: ".agents/skills/probe/SKILL.md" },
			},
			{
				name: "Read",
				args: { path: "/tmp/sandbox/.cursor/skills/canvas/references/sdk.md" },
			},
			{
				name: "Read",
				args: { path: ".codex/skills/origin/SKILL.md" },
			},
		]);
		expect(skills).toEqual(["grill", "code-review", "probe", "canvas", "origin"]);
	});

	it("builds skillsInvoked on SDK traces", () => {
		const events = [
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Invoking grill" }],
				},
			},
			{
				type: "tool_call",
				name: "read",
				args: { path: ".claude/skills/grill/SKILL.md" },
			},
		];
		const trace = buildTraceFromSdkMessages(events);
		const acc = createTraceAccumulator();
		for (const event of events) {
			accumulateSdkEvent(acc, event);
		}
		expect(finalizeTraceAccumulator(acc)).toEqual(trace);
		expect(trace.skillsInvoked).toContain("grill");
		expect(trace.toolCalls).toEqual([
			{ name: "read", args: { path: ".claude/skills/grill/SKILL.md" }, seq: 1 },
		]);
	});

	it("resolves a total from input and output when totalTokens is missing", () => {
		expect(resolvedTotalTokens({ inputTokens: 11, outputTokens: 4 })).toBe(15);
		expect(resolvedTotalTokens({ totalTokens: 20, inputTokens: 11, outputTokens: 4 })).toBe(20);
		expect(resolvedTotalTokens({})).toBeUndefined();
	});

	it("accumulates usage events into trace.usage", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "usage",
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					totalTokens: 15,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
				},
			},
			{
				type: "usage",
				usage: {
					inputTokens: 3,
					outputTokens: 2,
					totalTokens: 5,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
		]);
		expect(trace.usage).toEqual({
			inputTokens: 13,
			outputTokens: 7,
			totalTokens: 20,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
		});
	});

	it("captures MCP tool calls with args and result from SDK root result", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "tool_call",
				call_id: "call-echo-1",
				name: "echo",
				args: { text: "mcp echo ok" },
			},
			{
				type: "tool_call",
				call_id: "call-echo-1",
				name: "echo",
				args: { text: "mcp echo ok" },
				result: { content: [{ type: "text", text: "mcp echo ok" }], isError: false },
			},
		]);
		expect(trace.toolCalls).toEqual([
			{
				name: "echo",
				args: { text: "mcp echo ok" },
				result: JSON.stringify({
					content: [{ type: "text", text: "mcp echo ok" }],
					isError: false,
				}),
				seq: 0,
			},
		]);
	});

	it("captures shell commands from Cursor SDK tool_call events", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "tool_call",
				name: "shell",
				args: {
					command: "bun run validate:changed apps/client/src/utils/post-login-redirect.ts",
				},
			},
		]);
		expect(trace.shellCommands.some((cmd) => cmd.includes("validate:changed"))).toBe(true);
	});

	it("captures Cursor shell success from the structured result", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "tool_call",
				call_id: "shell-1",
				name: "shell",
				args: { command: "bun test" },
			},
			{
				type: "tool_call",
				call_id: "shell-1",
				name: "shell",
				args: { command: "bun test" },
				result: {
					status: "success",
					value: { exitCode: 0, stdout: "pass", stderr: "" },
				},
			},
		]);
		expect(trace.toolCalls[0]).toMatchObject({ exitCode: 0, succeeded: true });
	});

	it("does not treat skill-name prose as an invoke", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Following the grill skill protocol. I will pressure-test this.",
						},
					],
				},
			},
		]);
		expect(trace.skillsInvoked ?? []).toEqual([]);
	});

	it("infers review depth from synthesis header", () => {
		expect(inferReviewDepthFromText("Review · staged · Standard · path")).toBe("standard");
	});

	it("extracts shell commands from tool output", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Running validate" }],
				},
			},
			{
				type: "tool_result",
				tool: {
					name: "shell",
					output: "bun run validate:changed apps/client/src/foo.ts",
				},
			},
		]);
		expect(trace.shellCommands.some((cmd) => cmd.includes("validate:changed"))).toBe(true);
		expect(trace.toolCalls).toEqual([
			{
				name: "shell",
				args: undefined,
				result: "bun run validate:changed apps/client/src/foo.ts",
				seq: 1,
			},
		]);
	});

	it("infers tier from routing prose", () => {
		const routing = inferRoutingFromText("**Tier:** medium — fuzzy intent");
		expect(routing?.tier).toBe("medium");
	});

	it("infers lowercase inline tier", () => {
		const routing = inferRoutingFromText("Tier: low — hygiene fix");
		expect(routing?.tier).toBe("low");
	});

	it("infers hands-on leading-word tier", () => {
		expect(inferRoutingFromText("Medium — fuzzy intent, stating branches first")?.tier).toBe(
			"medium",
		);
	});

	it("infers **Routing:** Medium hands-on announce", () => {
		expect(inferRoutingFromText("**Routing:** Medium — score panel UX")?.tier).toBe("medium");
	});

	it("infers Routing: Medium without markdown bold", () => {
		expect(inferRoutingFromText("Routing: Medium — will outline branches")?.tier).toBe("medium");
	});

	it("infers Routing: **Low** with markdown-bold tier", () => {
		expect(inferRoutingFromText("Routing: **Low** — single-file guard fix.")?.tier).toBe("low");
	});

	it("does not infer tier from unrelated medium prose", () => {
		expect(inferRoutingFromText("A medium-sized refactor across packages")).toBeUndefined();
	});

	it("infers PR routing block from assistant text", () => {
		const body = inferPrBodyFromText("## Routing\n- **Tier:** medium");
		expect(body).toContain("## Routing");
	});

	it("enriches trace from transcript", () => {
		const enriched = enrichTrace({
			messages: [{ role: "assistant", content: "Tier: Low — hygiene fix" }],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		});
		expect(enriched.routing?.tier).toBe("low");
	});

	it("enriches tier from streamed token chunks without newline joins", () => {
		const enriched = enrichTrace({
			messages: [
				{ role: "assistant", content: "**" },
				{ role: "assistant", content: "Tier" },
				{ role: "assistant", content: ":**" },
				{ role: "assistant", content: " Medium" },
			],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		});
		expect(enriched.routing?.tier).toBe("medium");
	});

	it("finalizes streamed assistant chunks into a contiguous tier match", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "## Routing\n- **" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Tier" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: ":**" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: " Medium\n- **Signals:** pr" }],
				},
			},
		]);
		expect(trace.routing?.tier).toBe("medium");
		expect(trace.prBody).toContain("## Routing");
		expect(trace.prBody).toContain("**Tier:** Medium");
		expect(trace.messages).toEqual([
			{
				role: "assistant",
				content: "## Routing\n- **Tier:** Medium\n- **Signals:** pr",
				seq: 0,
			},
		]);
	});

	it("coalesces streamed assistant tokens and flushes a new turn after tools", () => {
		const trace = buildTraceFromSdkMessages([
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "##" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: " Routing" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "\n- **Tier:** Medium\n" }],
				},
			},
			{
				type: "tool_call",
				name: "Read",
				args: { path: "code-review/SKILL.md" },
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Review" }],
				},
			},
			{
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "text", text: " · staged" }],
				},
			},
		]);
		expect(trace.messages).toEqual([
			{
				role: "assistant",
				content: "## Routing\n- **Tier:** Medium\n",
				seq: 0,
			},
			{
				role: "assistant",
				content: "Review · staged",
				seq: 2,
			},
		]);
		expect(trace.toolCalls).toEqual([
			{ name: "Read", args: { path: "code-review/SKILL.md" }, seq: 1 },
		]);
		expect(trace.assistantTextBeforeTools).toBe("## Routing\n- **Tier:** Medium\n");
		expect(trace.routing?.tier).toBe("medium");
	});

	it("requires tier in assistant prefix before tool calls", () => {
		const pass: AgentTrace = {
			messages: [{ role: "assistant", content: "Routing: Low — fix.\n\nReading…" }],
			toolCalls: [{ name: "Read", args: { path: "foo.ts" } }],
			shellCommands: [],
			artifacts: {},
		};
		const fail: AgentTrace = {
			messages: [
				{ role: "assistant", content: "Reading…" },
				{ role: "assistant", content: "Routing: Low — done." },
			],
			toolCalls: [{ name: "Read", args: { path: "foo.ts" } }],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "Reading…",
		};
		expect(handsOnTierBeforeTools(pass, "low")).toBe(true);
		expect(handsOnTierBeforeTools(fail, "low")).toBe(false);
		expect(assistantPrefixBeforeTools(fail)).toBe("Reading…");
	});

	it("uses the full assistant reply when no tool was called", () => {
		const trace: AgentTrace = {
			messages: [{ role: "assistant", content: "Routing: Low — one direct reply." }],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "",
		};
		expect(assistantPrefixBeforeTools(trace)).toBe("Routing: Low — one direct reply.");
		expect(handsOnTierBeforeTools(trace, "low")).toBe(true);
	});

	it("requires ## Routing in assistant prefix before tool calls", () => {
		const pass: AgentTrace = {
			messages: [
				{
					role: "assistant",
					content: "## Routing\n- **Tier:** Medium\n\nExploring…",
				},
			],
			toolCalls: [{ name: "Glob", args: {} }],
			shellCommands: [],
			artifacts: {},
		};
		const fail: AgentTrace = {
			messages: [
				{ role: "assistant", content: "Exploring…" },
				{ role: "assistant", content: "## Routing\n- **Tier:** Medium" },
			],
			toolCalls: [{ name: "Glob", args: {} }],
			shellCommands: [],
			artifacts: {},
			assistantTextBeforeTools: "Exploring…",
		};
		expect(routingBlockBeforeTools(pass)).toBe(true);
		expect(routingBlockBeforeTools(fail)).toBe(false);
	});
});
