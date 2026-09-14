import { describe, expect, it } from "bun:test";

import {
	buildScenarioStory,
	describeRubricChecks,
	describeTraceHappened,
} from "../scenario-story.js";

describe("describeRubricChecks", () => {
	it("lists each smoke check in one line", () => {
		expect(
			describeRubricChecks({
				must: ["smoke ok"],
				mustNotCallTool: ["Shell", "Bash"],
			}),
		).toEqual(['reply includes "smoke ok"', "no Shell call", "no Bash call"]);
	});

	it("describes a required read path", () => {
		expect(describeRubricChecks({ mustReadPath: [".agents/skills/skeleton/SKILL.md"] })).toEqual([
			"read .agents/skills/skeleton/SKILL.md",
		]);
	});

	it("describes a command allowlist", () => {
		expect(
			describeRubricChecks({
				allowedCommands: ["npm install @csark0812/skeleton", "skeleton init"],
			}),
		).toEqual(["shell commands stay on the allowlist"]);
	});
});

describe("describeTraceHappened", () => {
	it("summarizes a no-tool reply", () => {
		expect(
			describeTraceHappened({
				messages: [{ role: "assistant", content: "smoke ok" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
			}),
		).toEqual(['agent replied "smoke ok"', "no tools"]);
	});

	it("names a Read path", () => {
		expect(
			describeTraceHappened({
				messages: [{ role: "assistant", content: "# Skeleton" }],
				toolCalls: [
					{
						name: "Read",
						args: {
							path: "/private/var/folders/f_/tmp/T/agent-harness-seal-x/.agents/skills/skeleton/SKILL.md",
						},
					},
				],
				shellCommands: [],
				artifacts: {},
			}),
		).toEqual(['agent replied "# Skeleton"', "Read .agents/skills/skeleton/SKILL.md"]);
	});
});

describe("buildScenarioStory", () => {
	it("marks a pass with criteria and result", () => {
		const story = buildScenarioStory({
			rubric: { must: ["smoke ok"], mustNotCallTool: ["Shell"] },
			trace: {
				messages: [{ role: "assistant", content: "smoke ok" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
			},
			passed: true,
			failures: [],
		});
		expect(story.criteria).toContain('reply includes "smoke ok"');
		expect(story.result).toContain("no tools");
		expect(story.verdict).toEqual([]);
	});

	it("lists each compare arm description in the criteria", () => {
		const story = buildScenarioStory({
			rubric: {},
			passed: true,
			failures: [],
			compare: {
				aLabel: "control",
				bLabel: "experimental",
				aDescription: "Intact catalog. Names the real Billing API webhook.",
				bDescription: "Contested catalog. Reports duplicate summaries.",
			},
		});
		expect(story.criteria).toContain("compare control vs experimental");
		expect(story.criteria).toContain(
			"control: Intact catalog. Names the real Billing API webhook.",
		);
		expect(story.criteria).toContain(
			"experimental: Contested catalog. Reports duplicate summaries.",
		);
	});

	it("lists both compare arms in the result", () => {
		const story = buildScenarioStory({
			rubric: { judge: ["Did the arms differ?"] },
			passed: true,
			failures: [],
			compare: {
				aLabel: "alpha",
				bLabel: "beta",
				aTrace: {
					messages: [
						{ role: "assistant", content: "alpha-compare-a7c1" },
						{ role: "assistant", content: "alpha follow-up" },
					],
					toolCalls: [{ name: "Read", args: { path: "word.txt" } }],
					shellCommands: [],
					artifacts: {},
					usage: { totalTokens: 400 },
				},
				bTrace: {
					messages: [{ role: "assistant", content: "beta-compare-b3e9" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
					usage: { totalTokens: 100 },
				},
			},
		});
		expect(story.criteria.some((line) => line.includes("compare alpha vs beta"))).toBe(true);
		expect(story.criteria.some((line) => line.includes("judge answers"))).toBe(true);
		expect(story.result.some((line) => line.startsWith("alpha:"))).toBe(true);
		expect(story.result.some((line) => line.startsWith("beta:"))).toBe(true);
		expect(story.result).toContain("beta uses fewer turns than alpha (1 vs 2)");
		expect(story.result).toContain("beta uses fewer tokens than alpha (100 vs 400)");
		expect(story.result).toContain("beta makes fewer tool calls than alpha (0 vs 1)");
	});

	it("lists metric gates without a judge", () => {
		const story = buildScenarioStory({
			rubric: {},
			passed: true,
			failures: [],
			compare: {
				aLabel: "alpha",
				bLabel: "beta",
				faster: "a",
				cheaper: "b",
			},
		});
		expect(story.criteria).toContain("compare alpha vs beta");
		expect(story.criteria).toContain("alpha uses fewer turns than beta");
		expect(story.criteria).toContain("beta uses fewer tokens than alpha");
		expect(story.criteria.some((line) => line.includes("judge"))).toBe(false);
	});

	it("lists named arms and cheaper pairs in the criteria", () => {
		const story = buildScenarioStory({
			rubric: {},
			passed: true,
			failures: [],
			compare: {
				arms: [
					{ id: "skel-clean", label: "skeleton clean", description: "Skill on a clean catalog." },
					{
						id: "none-clean",
						label: "no skill clean",
						description: "No skill on a clean catalog.",
					},
					{ id: "skel-messy", label: "skeleton messy", description: "Skill on a messy catalog." },
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
		expect(story.criteria).toContain(
			"compare skeleton clean, no skill clean, skeleton messy, and no skill messy",
		);
		expect(story.criteria).toContain("skeleton clean uses fewer tokens than no skill clean");
		expect(story.criteria).toContain("skeleton messy uses fewer tokens than no skill messy");
		expect(story.criteria).toContain("skeleton clean: Skill on a clean catalog.");
	});

	it("lists per-arm rubric checks on a skill compare", () => {
		const story = buildScenarioStory({
			rubric: { mustReadPath: ["note.md"] },
			passed: true,
			failures: [],
			compare: {
				aLabel: "no skill",
				bLabel: "with skill",
				cheaper: "b",
				aRubric: { mustNotInvokeSkill: ["brief-ship"] },
				bRubric: { mustInvokeSkill: ["brief-ship"] },
			},
		});
		expect(story.criteria).toContain("read note.md");
		expect(story.criteria).toContain("with skill uses fewer tokens than no skill");
		expect(story.criteria).toContain("no skill: no brief-ship skill");
		expect(story.criteria).toContain("with skill: invoke skill brief-ship");
	});

	it("puts a worktree leak in the result verdict", () => {
		const story = buildScenarioStory({
			rubric: { mustReadPath: ["SKILL.md"] },
			trace: {
				messages: [],
				toolCalls: [{ name: "Read", args: { path: "/private/tmp/seal/SKILL.md" } }],
				shellCommands: [],
				artifacts: {},
			},
			passed: false,
			failures: [
				{
					matcher: "workingTreeLeak",
					message: "agent used paths outside the sealed workspace: /private/tmp/seal/SKILL.md",
					category: "worktree_leak",
				},
			],
		});
		expect(story.criteria).toEqual(["read SKILL.md"]);
		expect(story.result).toEqual(["Read …/tmp/seal/SKILL.md"]);
		expect(story.verdict[0]).toContain("worktree leak");
		expect(story.verdict[0]).toContain("…/tmp/seal/SKILL.md");
		expect(story.verdict[0]).not.toContain("/private/tmp/seal/SKILL.md");
	});

	it("scores shared rubric checks on each compare arm", () => {
		const story = buildScenarioStory({
			rubric: { mustNot: ["audit all"] },
			passed: false,
			failures: [
				{
					matcher: "mustNotInclude",
					message: 'audit-all: forbidden text present: "audit all"',
				},
			],
			compare: {
				aLabel: "cli-lanes",
				bLabel: "audit-all",
				aDescription: "Attest token is ATTEST_CMD=skeleton audit docs.",
				bDescription: "Attest token is ATTEST_CMD=audit all.",
				aRubric: { must: ["ATTEST_CMD=skeleton audit docs"] },
				bRubric: { must: ["ATTEST_CMD=audit all"] },
			},
		});
		expect(story.sections).toBeDefined();
		const cli = story.sections?.find((section) => section.title === "cli-lanes");
		const audit = story.sections?.find((section) => section.title === "audit-all");
		expect(cli?.description).toBe("Attest token is ATTEST_CMD=skeleton audit docs.");
		expect(audit?.description).toBe("Attest token is ATTEST_CMD=audit all.");
		expect(cli?.checks.some((check) => check.text.includes("description"))).toBe(false);
		expect(cli?.checks).toContainEqual({
			text: 'reply includes "ATTEST_CMD=skeleton audit docs"',
			status: "pass",
		});
		expect(cli?.checks).toContainEqual({
			text: 'reply omits "audit all"',
			status: "pass",
		});
		expect(audit?.checks).toContainEqual({
			text: 'reply omits "audit all"',
			status: "fail",
		});
		expect(story.verdict.some((line) => line.includes("forbidden text"))).toBe(false);
	});

	it("scores a faster gate on the compare section", () => {
		const story = buildScenarioStory({
			rubric: {},
			passed: false,
			failures: [
				{
					matcher: "faster",
					message: "cli-lanes must use fewer turns than audit-all (5 vs 3)",
				},
			],
			compare: {
				aLabel: "cli-lanes",
				aTrace: {
					messages: [
						{ role: "assistant", content: "t1" },
						{ role: "assistant", content: "t2" },
						{ role: "assistant", content: "t3" },
						{ role: "assistant", content: "t4" },
						{ role: "assistant", content: "t5" },
					],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
				bLabel: "audit-all",
				bTrace: {
					messages: [
						{ role: "assistant", content: "u1" },
						{ role: "assistant", content: "u2" },
						{ role: "assistant", content: "u3" },
					],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
				faster: "a",
			},
		});
		const compare = story.sections?.find((section) => section.title === "compare");
		expect(compare?.checks).toContainEqual({
			text: "audit-all uses fewer turns than cli-lanes (3 vs 5)",
			status: "fail",
		});
	});

	it("keeps an unmatched worktree leak on the leftover verdict", () => {
		const story = buildScenarioStory({
			rubric: { must: ["smoke ok"] },
			trace: {
				messages: [{ role: "assistant", content: "smoke ok" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
			},
			passed: false,
			failures: [
				{
					matcher: "workingTreeLeak",
					message: "agent used paths outside the sealed workspace: /private/tmp/seal",
					category: "worktree_leak",
				},
			],
		});
		expect(story.sections?.[0]?.checks).toContainEqual({
			text: 'reply includes "smoke ok"',
			status: "pass",
		});
		expect(story.verdict[0]).toContain("worktree leak");
	});
});
