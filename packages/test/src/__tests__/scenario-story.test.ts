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
