import { describe, expect, it } from "bun:test";

import {
	applyCompareArm,
	applySidecarCompareDurations,
	assertCompareMetrics,
	compareArmDescription,
	compareArmLabel,
	describeCompareOutcome,
	mergeArmRubric,
	plainDescription,
	prefixCompareFailures,
} from "../compare-scenario.js";
import type { AgentScenario, ScenarioCompareResult } from "../types.js";

const base: AgentScenario = {
	name: "pair",
	prompt: "shared prompt",
	workspace: "workspaces/shared",
	compare: {
		a: { label: "alpha", workspace: "workspaces/a" },
		b: { label: "beta", prompt: "arm b prompt" },
	},
	rubric: { judge: ["Did A and B differ?"] },
};

describe("compare-scenario", () => {
	it("uses the arm label or A/B", () => {
		expect(compareArmLabel(base.compare?.a, "a")).toBe("alpha");
		expect(compareArmLabel(undefined, "b")).toBe("B");
	});

	it("trims a description and drops blank text", () => {
		expect(plainDescription("  Checks the short prompt.  ")).toBe("Checks the short prompt.");
		expect(plainDescription("   ")).toBeUndefined();
		expect(compareArmDescription({ description: " Asks for one sentence. " })).toBe(
			"Asks for one sentence.",
		);
	});

	it("applies arm overrides and drops compare", () => {
		const a = applyCompareArm(base, "a");
		const b = applyCompareArm(base, "b");
		expect(a.compare).toBeUndefined();
		expect(a.workspace).toBe("workspaces/a");
		expect(a.prompt).toBe("shared prompt");
		expect(b.workspace).toBe("workspaces/shared");
		expect(b.prompt).toBe("arm b prompt");
	});

	it("merges arm rubric arrays and keeps the pairwise judge", () => {
		const merged = mergeArmRubric(
			{ must: ["shared"], judge: ["Did B stay closer to the note?"] },
			{ mustInvokeSkill: ["brief-ship"], must: ["SHIP: token"] },
		);
		expect(merged.must).toEqual(["shared", "SHIP: token"]);
		expect(merged.mustInvokeSkill).toEqual(["brief-ship"]);
		expect(merged.judge).toEqual(["Did B stay closer to the note?"]);
	});

	it("applies the merged arm rubric", () => {
		const scenario: AgentScenario = {
			...base,
			rubric: { mustReadPath: ["note.md"], judge: ["Was B more faithful?"] },
			compare: {
				a: { label: "no skill", rubric: { mustNotInvokeSkill: ["brief-ship"] } },
				b: { label: "with skill", rubric: { mustInvokeSkill: ["brief-ship"] } },
			},
		};
		const a = applyCompareArm(scenario, "a");
		const b = applyCompareArm(scenario, "b");
		expect(a.rubric.mustNotInvokeSkill).toEqual(["brief-ship"]);
		expect(a.rubric.mustInvokeSkill).toBeUndefined();
		expect(b.rubric.mustInvokeSkill).toEqual(["brief-ship"]);
		expect(b.rubric.mustReadPath).toEqual(["note.md"]);
		expect(b.rubric.judge).toEqual(["Was B more faithful?"]);
	});

	it("prefixes arm failures with the label", () => {
		const failures = prefixCompareFailures("alpha", [
			{ matcher: "must", message: "missing word", category: "rubric_miss" },
		]);
		expect(failures[0]?.message).toBe("alpha: missing word");
		expect(failures[0]?.matcher).toBe("must");
	});

	it("scores cheaper and faster when the named arm wins", () => {
		const pair = pairResult({ aMs: 2000, bMs: 800, aTokens: 400, bTokens: 100 });
		expect(assertCompareMetrics({ faster: "b", cheaper: "b" }, pair)).toEqual([]);
	});

	it("fails cheaper and faster when the named arm does not win", () => {
		const pair = pairResult({ aMs: 800, bMs: 2000, aTokens: 100, bTokens: 400 });
		const failures = assertCompareMetrics({ faster: "b", cheaper: "b" }, pair);
		expect(failures.map((failure) => failure.matcher)).toEqual(["faster", "cheaper"]);
	});

	it("fails cheaper when a token count is missing", () => {
		const pair = pairResult({ aMs: 800, bMs: 2000, aTokens: 100 });
		const failures = assertCompareMetrics({ cheaper: "a" }, pair);
		expect(failures[0]?.matcher).toBe("cheaper");
		expect(failures[0]?.message).toContain("did not report tokens");
	});

	it("describes which arm is faster, cheaper, and lighter on tools", () => {
		const pair = pairResult({ aMs: 1200, bMs: 800, aTokens: 400, bTokens: 100 });
		pair.a.trace = {
			messages: [],
			toolCalls: [{ name: "Read", args: { path: "word.txt" } }],
			shellCommands: [],
			artifacts: {},
			usage: { totalTokens: 400 },
		};
		expect(describeCompareOutcome(pair)).toEqual([
			"beta is faster than alpha (800ms vs 1.2s)",
			"beta uses fewer tokens than alpha (100 vs 400)",
			"beta makes fewer tool calls than alpha (0 vs 1)",
		]);
	});

	it("describes a tie on duration", () => {
		const pair = pairResult({ aMs: 800, bMs: 800, aTokens: 50, bTokens: 50 });
		expect(describeCompareOutcome(pair)).toEqual([
			"both arms took 800ms",
			"both arms use 50 tokens",
			"both arms make 0 tool calls",
		]);
	});

	it("applies sidecar arm durations", () => {
		const pair = pairResult({ aMs: 1, bMs: 1, aTokens: 1, bTokens: 1 });
		const merged = applySidecarCompareDurations(pair, {
			compare: { a: { durationMs: 40 }, b: { durationMs: 12 } },
		});
		expect(merged.a.durationMs).toBe(40);
		expect(merged.b.durationMs).toBe(12);
	});
});

function pairResult(options: {
	aMs: number;
	bMs: number;
	aTokens?: number;
	bTokens?: number;
}): ScenarioCompareResult {
	return {
		a: {
			id: "a",
			label: "alpha",
			prompt: "a",
			durationMs: options.aMs,
			trace: {
				messages: [],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
				usage: options.aTokens === undefined ? undefined : { totalTokens: options.aTokens },
			},
		},
		b: {
			id: "b",
			label: "beta",
			prompt: "b",
			durationMs: options.bMs,
			trace: {
				messages: [],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
				usage: options.bTokens === undefined ? undefined : { totalTokens: options.bTokens },
			},
		},
	};
}
