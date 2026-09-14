import { describe, expect, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";

import { assertCompareGates, buildCompareResult } from "../compare-scenario.js";
import { assertRubric } from "../expect.js";
import { assertionFailure } from "../failures.js";
import { shouldFailScenario } from "../suite-summary.js";
import type { CompareArmResult } from "../types.js";

function trace(text: string, tools: string[] = [], tokens = 10): AgentTrace {
	return {
		messages: [{ role: "assistant", content: text }],
		toolCalls: tools.map((name) => ({ name })),
		shellCommands: [],
		artifacts: {},
		usage: { totalTokens: tokens },
	};
}

function arm(id: string, passed: boolean, tokens = 10): CompareArmResult {
	return { id, label: id, prompt: "Test the arm.", passed, trace: trace("OK", [], tokens) };
}

describe("deterministic experiment controls", () => {
	it("detects good and bad text", () => {
		expect(assertRubric(trace("GOOD"), { must: ["GOOD"], mustNot: ["BAD"] })).toHaveLength(0);
		expect(assertRubric(trace("BAD"), { must: ["GOOD"], mustNot: ["BAD"] })).toHaveLength(2);
	});

	it("detects required forbidden ordered and reversed tools", () => {
		expect(
			assertRubric(trace("OK", ["search_tasks", "get_task"]), {
				mustCallTool: ["search_tasks"],
				mustNotCallTool: ["Write"],
				mustCallToolsInOrder: ["search_tasks", "get_task"],
			}),
		).toHaveLength(0);
		expect(
			assertRubric(trace("OK", ["get_task", "search_tasks", "Write"]), {
				mustNotCallTool: ["Write"],
				mustCallToolsInOrder: ["search_tasks", "get_task"],
			}),
		).toHaveLength(2);
	});

	it("accepts an expected failed control through an outcome gate", () => {
		const result = buildCompareResult([arm("control", false), arm("experiment", true)]);
		expect(
			assertCompareGates(
				[
					{ metric: "outcome", arm: "control", operator: "equal", value: "fail" },
					{ metric: "outcome", arm: "experiment", operator: "equal", value: "pass" },
				],
				result,
			),
		).toHaveLength(0);
		expect(
			assertCompareGates([{ metric: "outcome", winner: "experiment", loser: "control" }], result),
		).toHaveLength(0);
		expect(
			assertCompareGates([{ metric: "outcome", winner: "control", loser: "experiment" }], result),
		).toHaveLength(1);
		expect(
			assertCompareGates(
				[{ metric: "outcome", winner: "experiment", loser: "also-passing" }],
				buildCompareResult([arm("experiment", true), arm("also-passing", true)]),
			),
		).toHaveLength(1);
	});

	it("detects numeric wins losses ties and absolute limits", () => {
		const win = buildCompareResult([arm("a", true, 10), arm("b", true, 20)]);
		expect(assertCompareGates([{ metric: "tokens", winner: "a", loser: "b" }], win)).toHaveLength(
			0,
		);
		expect(assertCompareGates([{ metric: "tokens", winner: "b", loser: "a" }], win)).toHaveLength(
			1,
		);
		expect(
			assertCompareGates([{ metric: "tokens", arm: "a", operator: "atMost", value: 10 }], win),
		).toHaveLength(0);
		const absoluteCases = [
			["equal", 10, 11],
			["lessThan", 11, 10],
			["atMost", 10, 9],
			["atLeast", 10, 11],
			["greaterThan", 9, 10],
		] as const;
		for (const [operator, passingValue, failingValue] of absoluteCases) {
			expect(
				assertCompareGates([{ metric: "tokens", arm: "a", operator, value: passingValue }], win),
			).toHaveLength(0);
			expect(
				assertCompareGates([{ metric: "tokens", arm: "a", operator, value: failingValue }], win),
			).toHaveLength(1);
		}
		const tie = buildCompareResult([arm("a", true, 10), arm("b", true, 10)]);
		expect(assertCompareGates([{ metric: "tokens", winner: "a", loser: "b" }], tie)).toHaveLength(
			1,
		);
	});

	it("detects judge wins losses ties and missing metrics", () => {
		const a = arm("a", true);
		const b = arm("b", true);
		a.judgeVerdicts = [{ id: "clear", question: "Is it clear?", pass: true, rationale: "Yes." }];
		b.judgeVerdicts = [{ id: "clear", question: "Is it clear?", pass: false, rationale: "No." }];
		const result = buildCompareResult([a, b]);
		expect(
			assertCompareGates([{ metric: "judge:clear", winner: "a", loser: "b" }], result),
		).toHaveLength(0);
		expect(
			assertCompareGates([{ metric: "judge:clear", winner: "b", loser: "a" }], result),
		).toHaveLength(1);
		b.judgeVerdicts[0] = { ...b.judgeVerdicts[0], pass: true };
		expect(
			assertCompareGates([{ metric: "judge:clear", winner: "a", loser: "b" }], result),
		).toHaveLength(1);
		expect(
			assertCompareGates([{ metric: "judge:missing", winner: "a", loser: "b" }], result),
		).toHaveLength(1);
		expect(
			assertCompareGates(
				[{ metric: "judge:clear", arm: "a", operator: "equal", value: "pass" }],
				result,
			),
		).toHaveLength(0);
		expect(
			assertCompareGates(
				[{ metric: "judge:clear", arm: "a", operator: "equal", value: "fail" }],
				result,
			),
		).toHaveLength(1);
	});

	it("keeps workspace leaks and judge format errors outside experiment outcomes", () => {
		const failures = [
			assertionFailure("workingTreeLeak", "A file escaped.", "worktree_leak"),
			assertionFailure("judge:clear", "The judge returned bad JSON.", "judge_parse"),
		];
		expect(shouldFailScenario(failures, "all")).toBe(true);
		expect(shouldFailScenario(failures, "behavior")).toBe(true);
	});
});
