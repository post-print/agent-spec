import { describe, expect, it } from "bun:test";

import { extractUserQuestions, mergeConversationTraces, runConversation } from "../conversation.js";
import type { AgentSession, AgentTrace } from "../types.js";

function session(partial: Partial<AgentSession> & { trace: AgentTrace }): AgentSession {
	return {
		host: "cursor",
		status: "completed",
		durationMs: 1,
		...partial,
	};
}

describe("extractUserQuestions", () => {
	it("reads Cursor AskQuestion payloads", () => {
		const questions = extractUserQuestions({
			messages: [],
			toolCalls: [
				{
					name: "AskQuestion",
					args: {
						title: "Scope",
						questions: [
							{
								id: "depth",
								prompt: "How deep should the review go?",
								options: [{ id: "quick", label: "Quick" }],
							},
						],
					},
				},
			],
			shellCommands: [],
			artifacts: {},
		});
		expect(questions).toEqual([
			{
				toolName: "AskQuestion",
				prompt: "How deep should the review go?",
				options: ["Quick"],
			},
		]);
	});

	it("reads a Claude AskUserQuestion string", () => {
		const questions = extractUserQuestions({
			messages: [],
			toolCalls: [{ name: "AskUserQuestion", args: { question: "Which file?" } }],
			shellCommands: [],
			artifacts: {},
		});
		expect(questions[0]?.prompt).toBe("Which file?");
	});
});

describe("runConversation", () => {
	it("sends the user-simulator reply as the next turn", async () => {
		const prompts: string[] = [];
		const result = await runConversation({
			initialPrompt: "Review the change.",
			maxTurns: 3,
			async runTurn(prompt) {
				prompts.push(prompt);
				if (prompts.length === 1) {
					return session({
						trace: {
							messages: [{ role: "assistant", content: "Need a choice." }],
							toolCalls: [
								{
									name: "AskQuestion",
									args: { questions: [{ prompt: "Quick or thorough?" }] },
								},
							],
							shellCommands: [],
							artifacts: {},
						},
					});
				}
				return session({
					trace: {
						messages: [{ role: "assistant", content: "Review done." }],
						toolCalls: [{ name: "Read", args: { path: "AGENTS.md" } }],
						shellCommands: [],
						artifacts: {},
					},
				});
			},
			userSimulator: {
				async reply() {
					return "Thorough.";
				},
			},
		});

		expect(prompts[0]).toBe("Review the change.");
		expect(prompts[1]).toContain("Original task:");
		expect(prompts[1]).toContain("Review the change.");
		expect(prompts[1]).toContain("Thorough.");
		expect(prompts[1]).toContain("Conversation so far:");
		expect(result.status).toBe("completed");
		expect(result.trace.messages.map((m) => m.content)).toEqual([
			"Need a choice.",
			"Thorough.",
			"Review done.",
		]);
		expect(result.trace.toolCalls.map((call) => call.name)).toEqual(["AskQuestion", "Read"]);
		expect(result.trace.artifacts.conversationTurns).toBe("2");
	});

	it("fails when the agent keeps asking past maxTurns", async () => {
		const result = await runConversation({
			initialPrompt: "Start",
			maxTurns: 2,
			async runTurn() {
				return session({
					trace: {
						messages: [],
						toolCalls: [{ name: "AskQuestion", args: { questions: [{ prompt: "Again?" }] } }],
						shellCommands: [],
						artifacts: {},
					},
				});
			},
			userSimulator: {
				async reply() {
					return "ok";
				},
			},
		});
		expect(result.status).toBe("failed");
		expect(result.error).toMatch(/maxTurns/i);
	});
});

describe("mergeConversationTraces", () => {
	it("appends a user reply between agent turns", () => {
		const merged = mergeConversationTraces(
			{
				messages: [{ role: "assistant", content: "ask" }],
				toolCalls: [{ name: "AskQuestion" }],
				shellCommands: [],
				artifacts: {},
			},
			"Use the probe skill.",
			{
				messages: [{ role: "assistant", content: "done" }],
				toolCalls: [],
				shellCommands: ["bun test"],
				artifacts: {},
			},
		);
		expect(merged.messages).toEqual([
			{ role: "assistant", content: "ask" },
			{ role: "user", content: "Use the probe skill.", seq: 1 },
			{ role: "assistant", content: "done", seq: 2 },
		]);
		expect(merged.shellCommands).toEqual(["bun test"]);
	});
});
