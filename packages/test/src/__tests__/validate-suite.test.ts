import { describe, expect, it } from "bun:test";
import type { AgentSuiteFile } from "../types.js";
import { validateSuiteFile } from "../validate-suite.js";

describe("validate-suite", () => {
	it("rejects a non-array allowedCommands list", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					rubric: { allowedCommands: "npm install" as unknown as string[] },
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "rubric.allowedCommands")).toBe(true);
	});

	it("accepts an allowedCommands list", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "adopt",
						prompt: "Install and initialize @csark0812/skeleton in this repo.",
						rubric: {
							allowedCommands: [
								"npm install @csark0812/skeleton",
								"skeleton init",
								"skeleton audit self",
							],
							mustRun: ["@csark0812/skeleton", "skeleton init", "skeleton audit self"],
						},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects invalid tier enum", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					rubric: { tier: "MEDIUM" as unknown as "medium" },
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "rubric.tier")).toBe(true);
	});

	it("requires seedPatch when seedStageOnly is set", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					seedStageOnly: true,
					rubric: {},
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "seedStageOnly")).toBe(true);
	});

	it("accepts a skill path list", () => {
		const suite: AgentSuiteFile = {
			name: "ok",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					skills: [".agents/skills/skeleton/SKILL.md"],
					rubric: {},
				},
			],
		};
		expect(validateSuiteFile("/tmp/scenarios.json", suite)).toEqual([]);
	});

	it("rejects a bare skill name", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					skills: ["skeleton"],
					rubric: {},
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "skills")).toBe(true);
	});

	it("rejects an empty hosts list and a defaults.host outside hosts", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "bad",
				hosts: [],
				scenarios: [{ name: "case", prompt: "test", rubric: {} }],
			}).some((issue) => issue.field === "hosts"),
		).toBe(true);

		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			hosts: ["cursor", "claude"],
			defaults: { host: "openai" },
			scenarios: [{ name: "case", prompt: "test", rubric: {} }],
		});
		expect(issues.some((issue) => issue.field === "defaults.host")).toBe(true);
	});

	it("rejects an unregistered custom host", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			hosts: ["gemini"],
			scenarios: [{ name: "case", prompt: "test", rubric: {} }],
		});
		expect(issues.some((issue) => /unknown host "gemini"/.test(issue.message))).toBe(true);
	});

	it("accepts a hosts matrix that includes defaults.host", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				hosts: ["cursor", "claude"],
				defaults: { host: "cursor" },
				scenarios: [{ name: "case", prompt: "test", rubric: {} }],
			}),
		).toEqual([]);
	});

	it("rejects a workspace with parent segments", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					workspace: "agent-suites/../packages",
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "workspace")).toBe(true);
	});

	it("rejects a non-boolean allowUserSkills value", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					allowUserSkills: "yes" as unknown as boolean,
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "allowUserSkills")).toBe(true);
	});

	it("accepts a scenario description and arm descriptions", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						description: "Checks that a short prompt uses fewer tokens.",
						prompt: "test",
						compare: {
							a: {
								label: "alpha",
								description: "Asks for a long summary.",
								workspace: "agent-suites/judge/workspaces/compare-a",
							},
							b: {
								label: "beta",
								description: "Asks for one sentence.",
								workspace: "agent-suites/judge/workspaces/compare-b",
							},
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects an empty scenario description", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "case",
					description: "   ",
					prompt: "test",
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "description")).toBe(true);
	});

	it("rejects a compare arm with no description", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: {
							label: "alpha",
							workspace: "agent-suites/judge/workspaces/compare-a",
						},
						b: {
							label: "beta",
							description: "Asks for one sentence.",
							workspace: "agent-suites/judge/workspaces/compare-b",
						},
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.a.description")).toBe(true);
	});

	it("rejects an empty compare arm description", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: { description: "" },
						b: {},
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.a.description")).toBe(true);
	});

	it("accepts a compare scenario without a judge", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						prompt: "test",
						compare: {
							a: {
								label: "alpha",
								description: "Asks for a long summary.",
								workspace: "agent-suites/judge/workspaces/compare-a",
							},
							b: {
								label: "beta",
								description: "Asks for one sentence.",
								workspace: "agent-suites/judge/workspaces/compare-b",
							},
							cheaper: "b",
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects compare.faster that is not a or b", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: {},
						b: {},
						faster: "c" as "a",
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.faster")).toBe(true);
	});

	it("accepts a compare scenario with two arms and a judge question", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						prompt: "test",
						compare: {
							a: {
								label: "alpha",
								description: "Reads word.txt from the alpha workspace.",
								workspace: "agent-suites/judge/workspaces/compare-a",
							},
							b: {
								label: "beta",
								description: "Reads word.txt from the beta workspace.",
								workspace: "agent-suites/judge/workspaces/compare-b",
							},
						},
						rubric: { judge: ["Did the arms differ?"] },
					},
				],
			}),
		).toEqual([]);
	});

	it("accepts per-arm rubric checks on a compare scenario", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						prompt: "test",
						compare: {
							a: {
								label: "no skill",
								description: "No brief-ship skill. The agent can write a longer plan.",
								workspace: "agent-suites/judge/workspaces/skill-off",
								rubric: { mustNotInvokeSkill: ["brief-ship"] },
							},
							b: {
								label: "with skill",
								description: "Uses the brief-ship skill. The agent must stay on the note.",
								workspace: "agent-suites/judge/workspaces/skill-on",
								skills: [".agents/skills/brief-ship/SKILL.md"],
								rubric: { mustInvokeSkill: ["brief-ship"] },
							},
							cheaper: "b",
						},
						rubric: { mustReadPath: ["note.md"] },
					},
				],
			}),
		).toEqual([]);
	});

	it("accepts named arms with cheaper pairs", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "docs quality cost",
						prompt: "Answer from the catalog.",
						compare: {
							arms: [
								{
									id: "skel-clean",
									description: "Uses the skeleton skill on a clean catalog.",
									workspace: "workspaces/skel-clean",
								},
								{
									id: "none-clean",
									description: "No skill on a clean catalog.",
									workspace: "workspaces/none-clean",
								},
								{
									id: "skel-messy",
									description: "Uses the skeleton skill on a messy catalog.",
									workspace: "workspaces/skel-messy",
								},
								{
									id: "none-messy",
									description: "No skill on a messy catalog.",
									workspace: "workspaces/none-messy",
								},
							],
							cheaper: [
								{ winner: "skel-clean", loser: "none-clean" },
								{ winner: "skel-messy", loser: "none-messy" },
							],
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects a single cheaper winner when compare has more than two arms", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "docs quality cost",
					prompt: "test",
					compare: {
						arms: [
							{ id: "skel-clean", description: "Skill on a clean catalog." },
							{ id: "none-clean", description: "No skill on a clean catalog." },
							{ id: "skel-messy", description: "Skill on a messy catalog." },
							{ id: "none-messy", description: "No skill on a messy catalog." },
						],
						cheaper: "skel-clean",
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.cheaper")).toBe(true);
	});

	it("rejects mixing compare.a with compare.arms", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: { description: "Asks for a long summary." },
						b: { description: "Asks for one sentence." },
						arms: [
							{ id: "skel-clean", description: "Skill on a clean catalog." },
							{ id: "none-clean", description: "No skill on a clean catalog." },
						],
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare")).toBe(true);
	});

	it("rejects a named arm without an id", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						arms: [
							{ description: "Skill on a clean catalog." },
							{ id: "none-clean", description: "No skill on a clean catalog." },
						],
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.arms[0].id")).toBe(true);
	});

	it("rejects a cheaper pair with an unknown arm", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						arms: [
							{ id: "skel-clean", description: "Skill on a clean catalog." },
							{ id: "none-clean", description: "No skill on a clean catalog." },
						],
						cheaper: [{ winner: "skel-clean", loser: "missing" }],
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.cheaper[0].loser")).toBe(true);
	});

	it("rejects judge questions on an arm rubric", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: { rubric: { judge: ["Did A win?"] } },
						b: {},
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.a.rubric.judge")).toBe(true);
	});

	it("accepts a repo-relative workspace", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				defaults: { workspace: "." },
				scenarios: [
					{
						name: "case",
						prompt: "test",
						workspace: "agent-suites/depth/workspaces/seed",
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects a bare catalog walk", () => {
		const suite: AgentSuiteFile = {
			name: "bad",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					skills: "catalog" as never,
					rubric: {},
				},
			],
		};
		const issues = validateSuiteFile("/tmp/scenarios.json", suite);
		expect(issues.some((issue) => issue.field === "skills")).toBe(true);
	});
});
