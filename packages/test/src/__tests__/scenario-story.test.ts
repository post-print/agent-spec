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

	it("lists both compare arms in the result", () => {
		const story = buildScenarioStory({
			rubric: { judge: ["Did the arms differ?"] },
			passed: true,
			failures: [],
			compare: {
				aLabel: "alpha",
				bLabel: "beta",
				aTrace: {
					messages: [{ role: "assistant", content: "alpha-compare-a7c1" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
				bTrace: {
					messages: [{ role: "assistant", content: "beta-compare-b3e9" }],
					toolCalls: [],
					shellCommands: [],
					artifacts: {},
				},
			},
		});
		expect(story.criteria.some((line) => line.includes("compare alpha vs beta"))).toBe(true);
		expect(story.criteria.some((line) => line.includes("judge answers"))).toBe(true);
		expect(story.result.some((line) => line.startsWith("alpha:"))).toBe(true);
		expect(story.result.some((line) => line.startsWith("beta:"))).toBe(true);
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
		expect(story.criteria).toContain("alpha is faster than beta");
		expect(story.criteria).toContain("beta uses fewer tokens than alpha");
		expect(story.criteria.some((line) => line.includes("judge"))).toBe(false);
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
});
