import { describe, expect, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";
import {
	applyCompareArm,
	assertCompareGates,
	buildCompareResult,
	compareArmTokens,
	compareArmTools,
	compareArmTurns,
	evaluateCompareGates,
	mergeArmRubric,
	resolveCompareArms,
} from "../compare-scenario.js";
import type { CompareArmResult, CompareGate } from "../index.js";

function trace(turns: number, tokens: number, tools: number): AgentTrace {
	return {
		messages: Array.from({ length: turns }, (_, index) => ({
			role: "assistant",
			content: `turn ${index}`,
		})),
		toolCalls: Array.from({ length: tools }, (_, index) => ({ name: `tool-${index}` })),
		shellCommands: [],
		artifacts: {},
		usage: { totalTokens: tokens },
	};
}

function arm(
	id: string,
	passed: boolean,
	turns: number,
	tokens: number,
	tools: number,
): CompareArmResult {
	return {
		id,
		label: id,
		prompt: "Do the task.",
		passed,
		durationMs: tokens,
		trace: trace(turns, tokens, tools),
	};
}

describe("comparison gates", () => {
	it("measures each arm", () => {
		const result = arm("tool", true, 2, 80, 1);
		expect(compareArmTurns(result)).toBe(2);
		expect(compareArmTokens(result)).toBe(80);
		expect(compareArmTools(result)).toBe(1);
	});

	it("passes independent outcome and cost gates", () => {
		const gates: CompareGate[] = [
			{ metric: "outcome", arm: "control", operator: "equal", value: "fail" },
			{ metric: "outcome", arm: "tool", operator: "equal", value: "pass" },
			{ metric: "tokens", winner: "tool", loser: "control" },
			{ metric: "tools", winner: "tool", loser: "control" },
		];
		const result = buildCompareResult(
			[arm("control", false, 4, 300, 4), arm("tool", true, 2, 80, 1)],
			gates,
		);
		expect(assertCompareGates(gates, result)).toEqual([]);
		expect(evaluateCompareGates(gates, result).every((gate) => gate.passed)).toBe(true);
	});

	it("fails a tie and missing metric", () => {
		const tie = buildCompareResult([arm("a", true, 1, 10, 0), arm("b", true, 1, 10, 0)]);
		expect(
			assertCompareGates([{ metric: "tokens", winner: "a", loser: "b" }], tie)[0]?.matcher,
		).toBe("compareGate:tokens");
		if (tie.b) tie.b.trace = undefined;
		expect(
			assertCompareGates([{ metric: "turns", winner: "a", loser: "b" }], tie)[0]?.message,
		).toContain("undefined");
	});

	it("scores a judge metric for each arm", () => {
		const control = arm("control", true, 1, 10, 0);
		const tool = arm("tool", true, 1, 10, 0);
		control.judgeVerdicts = [
			{ id: "accuracy", question: "Is the answer correct?", pass: false, rationale: "No" },
		];
		tool.judgeVerdicts = [
			{ id: "accuracy", question: "Is the answer correct?", pass: true, rationale: "Yes" },
		];
		const result = buildCompareResult([control, tool]);
		expect(
			assertCompareGates([{ metric: "judge:accuracy", winner: "tool", loser: "control" }], result),
		).toEqual([]);
	});

	it("merges ordered tool rules into an arm", () => {
		const merged = mergeArmRubric(
			{ must: ["shared"] },
			{ mustCallToolsInOrder: ["find", "read:id-7"] },
		);
		expect(merged.mustCallToolsInOrder).toEqual(["find", "read:id-7"]);
	});

	it("applies named arm values", () => {
		const scenario = {
			name: "pair",
			prompt: "Do the task.",
			rubric: {},
			compare: {
				arms: [
					{ id: "control", description: "No tool." },
					{ id: "tool", description: "Use the tool.", prompt: "Use the tool." },
				],
			},
		};
		expect(resolveCompareArms(scenario.compare).map((entry) => entry.id)).toEqual([
			"control",
			"tool",
		]);
		expect(applyCompareArm(scenario, "tool").prompt).toBe("Use the tool.");
	});
});
