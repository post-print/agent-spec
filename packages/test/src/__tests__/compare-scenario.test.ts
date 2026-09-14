import { describe, expect, it } from "bun:test";

import {
	applyCompareArm,
	applySidecarCompareDurations,
	assertCompareMetrics,
	buildCompareResult,
	compareArmDescription,
	compareArmLabel,
	compareArmTokens,
	compareArmTurns,
	compareResultArms,
	compareStoryFields,
	describeCompareOutcome,
	mergeArmRubric,
	parseCompareArmId,
	plainDescription,
	prefixCompareFailures,
	requireCompareArm,
	resolveCompareArms,
	resolveCompareMetricPairs,
} from "../compare-scenario.js";
import type { AgentScenario, CompareArmResult, ScenarioCompareResult } from "../types.js";

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
	it("passes arm descriptions into story fields", () => {
		const fields = compareStoryFields({
			...base,
			compare: {
				a: {
					label: "control",
					description: " Intact catalog. Names the real Billing API webhook. ",
				},
				b: {
					label: "experimental",
					description: "Contested catalog. Reports duplicate summaries.",
				},
			},
		});
		expect(fields.aLabel).toBe("control");
		expect(fields.bLabel).toBe("experimental");
		expect(fields.aDescription).toBe("Intact catalog. Names the real Billing API webhook.");
		expect(fields.bDescription).toBe("Contested catalog. Reports duplicate summaries.");
	});

	it("uses the arm label or control and experimental", () => {
		expect(compareArmLabel(base.compare?.a, "a")).toBe("alpha");
		expect(compareArmLabel(undefined, "a")).toBe("control");
		expect(compareArmLabel(undefined, "b")).toBe("experimental");
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

	it("requires a known compare arm id", () => {
		expect(requireCompareArm(base, "b").prompt).toBe("arm b prompt");
		expect(() => requireCompareArm(base, "missing")).toThrow(
			"Scenario pair has no compare arm missing",
		);
	});

	it("merges arm rubric arrays and keeps the shared judge", () => {
		const merged = mergeArmRubric(
			{ must: ["shared"], judge: ["Did B stay closer to the note?"] },
			{ mustInvokeSkill: ["brief-ship"], must: ["SHIP: token"] },
		);
		expect(merged.must).toEqual(["shared", "SHIP: token"]);
		expect(merged.mustInvokeSkill).toEqual(["brief-ship"]);
		expect(merged.allowedCommands).toBeUndefined();
		expect(merged.judge).toEqual(["Did B stay closer to the note?"]);
	});

	it("appends arm allowedCommands onto the scenario allowlist", () => {
		const merged = mergeArmRubric(
			{ allowedCommands: ["npm install @csark0812/skeleton"] },
			{ allowedCommands: ["skeleton init"] },
		);
		expect(merged.allowedCommands).toEqual(["npm install @csark0812/skeleton", "skeleton init"]);
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
		const pair = pairResult({
			aMs: 2000,
			bMs: 800,
			aTokens: 400,
			bTokens: 100,
			aTurns: 5,
			bTurns: 2,
		});
		expect(assertCompareMetrics({ faster: "b", cheaper: "b" }, pair)).toEqual([]);
	});

	it("fails cheaper and faster when the named arm does not win", () => {
		const pair = pairResult({
			aMs: 800,
			bMs: 2000,
			aTokens: 100,
			bTokens: 400,
			aTurns: 2,
			bTurns: 5,
		});
		const failures = assertCompareMetrics({ faster: "b", cheaper: "b" }, pair);
		expect(failures.map((failure) => failure.matcher)).toEqual(["faster", "cheaper"]);
	});

	it("fails cheaper when a token count is missing", () => {
		const pair = pairResult({ aMs: 800, bMs: 2000, aTokens: 100 });
		const failures = assertCompareMetrics({ cheaper: "a" }, pair);
		expect(failures[0]?.matcher).toBe("cheaper");
		expect(failures[0]?.message).toContain("did not report tokens");
	});

	it("fails faster when a turn count is missing", () => {
		const pair = pairResult({
			aMs: 800,
			bMs: 200,
			aTokens: 100,
			bTokens: 50,
			aTurns: 3,
			bTurns: 1,
		});
		expect(pair.a).toBeDefined();
		if (pair.a) {
			pair.a.trace = undefined;
		}
		const failures = assertCompareMetrics({ faster: "a" }, pair);
		expect(failures[0]?.matcher).toBe("faster");
		expect(failures[0]?.message).toContain("did not report turns");
	});

	it("counts assistant messages and ignores user messages", () => {
		const pair = pairResult({ aMs: 1, bMs: 1, aTurns: 0 });
		pair.a.trace = {
			messages: [
				{ role: "user", content: "start" },
				{ role: "assistant", content: "first" },
				{ role: "assistant", content: "second" },
			],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
		};
		expect(compareArmTurns(pair.a)).toBe(2);
	});

	it("sums Codex input and output when totalTokens is missing", () => {
		const pair = pairResult({ aMs: 10, bMs: 10, aTokens: 1, bTokens: 1 });
		expect(pair.a).toBeDefined();
		if (!pair.a) {
			return;
		}
		pair.a.trace = {
			messages: [],
			toolCalls: [],
			shellCommands: [],
			artifacts: {},
			usage: { inputTokens: 11, outputTokens: 4 },
		};
		expect(compareArmTokens(pair.a)).toBe(15);
	});

	it("describes which arm uses fewer turns, tokens, and tools", () => {
		const pair = pairResult({
			aMs: 1200,
			bMs: 800,
			aTokens: 400,
			bTokens: 100,
			aTurns: 2,
			bTurns: 1,
		});
		pair.a.trace = {
			messages: [
				{ role: "assistant", content: "alpha-1" },
				{ role: "assistant", content: "alpha-2" },
			],
			toolCalls: [{ name: "Read", args: { path: "word.txt" } }],
			shellCommands: [],
			artifacts: {},
			usage: { totalTokens: 400 },
		};
		expect(describeCompareOutcome(pair)).toEqual([
			"beta uses fewer turns than alpha (1 vs 2)",
			"beta uses fewer tokens than alpha (100 vs 400)",
			"beta makes fewer tool calls than alpha (0 vs 1)",
		]);
	});

	it("describes a tie on turns", () => {
		const pair = pairResult({ aMs: 800, bMs: 800, aTokens: 50, bTokens: 50, aTurns: 2, bTurns: 2 });
		expect(describeCompareOutcome(pair)).toEqual([
			"both arms use 2 turns",
			"both arms use 50 tokens",
			"both arms make 0 tool calls",
		]);
	});

	it("applies sidecar arm durations", () => {
		const pair = pairResult({ aMs: 1, bMs: 1, aTokens: 1, bTokens: 1 });
		const merged = applySidecarCompareDurations(pair, {
			compare: { a: { durationMs: 40 }, b: { durationMs: 12 } },
		});
		expect(merged.a?.durationMs).toBe(40);
		expect(merged.b?.durationMs).toBe(12);
	});

	it("resolves the two-arm form as a and b", () => {
		expect(resolveCompareArms(base.compare)).toEqual([
			{ id: "a", arm: { label: "alpha", workspace: "workspaces/a" } },
			{ id: "b", arm: { label: "beta", prompt: "arm b prompt" } },
		]);
	});

	it("resolves named arms in author order", () => {
		const arms = resolveCompareArms({
			arms: [
				{ id: "skel-clean", label: "skeleton clean", description: "Skill on a clean catalog." },
				{ id: "none-clean", label: "no skill clean", description: "No skill on a clean catalog." },
				{ id: "skel-messy", description: "Skill on a messy catalog." },
				{ id: "none-messy", description: "No skill on a messy catalog." },
			],
		});
		expect(arms.map((entry) => entry.id)).toEqual([
			"skel-clean",
			"none-clean",
			"skel-messy",
			"none-messy",
		]);
	});

	it("parses a named arm slug", () => {
		expect(parseCompareArmId("a")).toBe("a");
		expect(parseCompareArmId("skel-clean")).toBe("skel-clean");
		expect(parseCompareArmId("None Clean")).toBeUndefined();
		expect(parseCompareArmId("")).toBeUndefined();
	});

	it("uses the arm id when a named arm has no label", () => {
		expect(compareArmLabel({ description: "Skill on a messy catalog." }, "skel-messy")).toBe(
			"skel-messy",
		);
	});

	it("turns a two-arm winner name into the other-arm pair", () => {
		expect(resolveCompareMetricPairs("b", ["a", "b"])).toEqual([{ winner: "b", loser: "a" }]);
		expect(resolveCompareMetricPairs("skel-clean", ["skel-clean", "none-clean"])).toEqual([
			{ winner: "skel-clean", loser: "none-clean" },
		]);
	});

	it("keeps named winner-versus-loser pairs", () => {
		expect(
			resolveCompareMetricPairs(
				[
					{ winner: "skel-clean", loser: "none-clean" },
					{ winner: "skel-messy", loser: "none-messy" },
				],
				["skel-clean", "none-clean", "skel-messy", "none-messy"],
			),
		).toEqual([
			{ winner: "skel-clean", loser: "none-clean" },
			{ winner: "skel-messy", loser: "none-messy" },
		]);
	});

	it("applies a named arm by id", () => {
		const scenario: AgentScenario = {
			...base,
			compare: {
				arms: [
					{ id: "skel-clean", workspace: "workspaces/skel-clean" },
					{ id: "none-clean", workspace: "workspaces/none-clean" },
				],
			},
		};
		const arm = applyCompareArm(scenario, "skel-clean");
		expect(arm.compare).toBeUndefined();
		expect(arm.workspace).toBe("workspaces/skel-clean");
	});

	it("scores named cheaper pairs without a four-way winner", () => {
		const result = fourArmResult({
			skelCleanTokens: 80,
			noneCleanTokens: 200,
			skelMessyTokens: 90,
			noneMessyTokens: 220,
		});
		expect(
			assertCompareMetrics(
				{
					cheaper: [
						{ winner: "skel-clean", loser: "none-clean" },
						{ winner: "skel-messy", loser: "none-messy" },
					],
				},
				result,
			),
		).toEqual([]);
	});

	it("fails only the named pair that loses", () => {
		const result = fourArmResult({
			skelCleanTokens: 80,
			noneCleanTokens: 200,
			skelMessyTokens: 300,
			noneMessyTokens: 220,
		});
		const failures = assertCompareMetrics(
			{
				cheaper: [
					{ winner: "skel-clean", loser: "none-clean" },
					{ winner: "skel-messy", loser: "none-messy" },
				],
			},
			result,
		);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.matcher).toBe("cheaper");
		expect(failures[0]?.message).toContain("skel-messy");
		expect(failures[0]?.message).toContain("none-messy");
		expect(failures[0]?.message).not.toContain("four-way");
	});

	it("describes named pairs and does not pick a four-way winner", () => {
		const result = fourArmResult({
			skelCleanMs: 800,
			noneCleanMs: 1200,
			skelMessyMs: 900,
			noneMessyMs: 1500,
			skelCleanTokens: 80,
			noneCleanTokens: 200,
			skelMessyTokens: 90,
			noneMessyTokens: 220,
		});
		result.cheaper = [
			{ winner: "skel-clean", loser: "none-clean" },
			{ winner: "skel-messy", loser: "none-messy" },
		];
		const lines = describeCompareOutcome(result);
		expect(lines.some((line) => line.includes("skel-clean") && line.includes("none-clean"))).toBe(
			true,
		);
		expect(lines.some((line) => line.includes("skel-messy") && line.includes("none-messy"))).toBe(
			true,
		);
		expect(lines.some((line) => /wins|winner of all|four-way/i.test(line))).toBe(false);
	});

	it("passes named-arm descriptions into story fields", () => {
		const fields = compareStoryFields({
			...base,
			compare: {
				arms: [
					{
						id: "skel-clean",
						label: "skeleton clean",
						description: "Skill on a clean catalog.",
					},
					{
						id: "none-clean",
						label: "no skill clean",
						description: "No skill on a clean catalog.",
					},
					{
						id: "skel-messy",
						label: "skeleton messy",
						description: "Skill on a messy catalog.",
					},
					{
						id: "none-messy",
						label: "no skill messy",
						description: "No skill on a messy catalog.",
					},
				],
				cheaper: [
					{ winner: "skel-clean", loser: "none-clean" },
					{ winner: "skel-messy", loser: "none-messy" },
				],
			},
		});
		expect(fields.arms.map((arm) => arm.id)).toEqual([
			"skel-clean",
			"none-clean",
			"skel-messy",
			"none-messy",
		]);
		expect(fields.cheaper).toEqual([
			{ winner: "skel-clean", loser: "none-clean" },
			{ winner: "skel-messy", loser: "none-messy" },
		]);
	});

	it("applies sidecar durations by arm id", () => {
		const result = fourArmResult({
			skelCleanMs: 1,
			noneCleanMs: 1,
			skelMessyMs: 1,
			noneMessyMs: 1,
			skelCleanTokens: 1,
			noneCleanTokens: 1,
			skelMessyTokens: 1,
			noneMessyTokens: 1,
		});
		const merged = applySidecarCompareDurations(result, {
			compare: {
				arms: {
					"skel-clean": { durationMs: 40 },
					"none-clean": { durationMs: 90 },
				},
			},
		});
		expect(merged.arms.find((arm) => arm.id === "skel-clean")?.durationMs).toBe(40);
		expect(merged.arms.find((arm) => arm.id === "none-clean")?.durationMs).toBe(90);
	});

	it("builds a result with a and b aliases for the two-arm form", () => {
		const result = buildCompareResult([
			armResult({ id: "a", label: "alpha", durationMs: 10, tokens: 4 }),
			armResult({ id: "b", label: "beta", durationMs: 8, tokens: 2 }),
		]);
		expect(compareResultArms(result).map((arm) => arm.id)).toEqual(["a", "b"]);
		expect(result.a?.label).toBe("alpha");
		expect(result.b?.label).toBe("beta");
	});
});

function armResult(options: {
	id: string;
	label: string;
	durationMs: number;
	tokens?: number;
	tools?: number;
	turns?: number;
}): CompareArmResult {
	const turns = options.turns ?? 1;
	return {
		id: options.id,
		label: options.label,
		prompt: options.id,
		durationMs: options.durationMs,
		trace: {
			messages: Array.from({ length: turns }, (_, index) => ({
				role: "assistant" as const,
				content: `${options.id}-turn-${index + 1}`,
			})),
			toolCalls: Array.from({ length: options.tools ?? 0 }, () => ({
				name: "Read",
				args: { path: "word.txt" },
			})),
			shellCommands: [],
			artifacts: {},
			usage: options.tokens === undefined ? undefined : { totalTokens: options.tokens },
		},
	};
}

function pairResult(options: {
	aMs: number;
	bMs: number;
	aTokens?: number;
	bTokens?: number;
	aTurns?: number;
	bTurns?: number;
}): ScenarioCompareResult {
	return buildCompareResult([
		armResult({
			id: "a",
			label: "alpha",
			durationMs: options.aMs,
			tokens: options.aTokens,
			turns: options.aTurns,
		}),
		armResult({
			id: "b",
			label: "beta",
			durationMs: options.bMs,
			tokens: options.bTokens,
			turns: options.bTurns,
		}),
	]);
}

function fourArmResult(options: {
	skelCleanMs?: number;
	noneCleanMs?: number;
	skelMessyMs?: number;
	noneMessyMs?: number;
	skelCleanTokens?: number;
	noneCleanTokens?: number;
	skelMessyTokens?: number;
	noneMessyTokens?: number;
}): ScenarioCompareResult {
	return buildCompareResult([
		armResult({
			id: "skel-clean",
			label: "skel-clean",
			durationMs: options.skelCleanMs ?? 800,
			tokens: options.skelCleanTokens,
		}),
		armResult({
			id: "none-clean",
			label: "none-clean",
			durationMs: options.noneCleanMs ?? 1200,
			tokens: options.noneCleanTokens,
		}),
		armResult({
			id: "skel-messy",
			label: "skel-messy",
			durationMs: options.skelMessyMs ?? 900,
			tokens: options.skelMessyTokens,
		}),
		armResult({
			id: "none-messy",
			label: "none-messy",
			durationMs: options.noneMessyMs ?? 1500,
			tokens: options.noneMessyTokens,
		}),
	]);
}
