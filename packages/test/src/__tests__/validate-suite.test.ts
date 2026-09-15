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

	it("accepts a mustRunSuccessfully list", () => {
		const suite: AgentSuiteFile = {
			name: "ok",
			scenarios: [
				{
					name: "repair",
					prompt: "Repair the bug and run bun test.",
					rubric: { mustRunSuccessfully: ["bun test"] },
				},
			],
		};
		expect(validateSuiteFile("/tmp/scenarios.json", suite)).toEqual([]);
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

	it("accepts an explicit network opt-in", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "install",
						prompt: "Install a package.",
						networkAccess: true,
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects a non-boolean networkAccess value", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "install",
					prompt: "Install a package.",
					networkAccess: "npm" as unknown as boolean,
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "networkAccess")).toBe(true);
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
							gates: [{ metric: "tokens", winner: "b", loser: "a" }],
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects the removed compare.faster field", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: {},
						b: {},
						faster: "c",
					},
					rubric: {},
				},
			],
		} as never);
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
							gates: [{ metric: "tokens", winner: "b", loser: "a" }],
						},
						rubric: { mustReadPath: ["note.md"] },
					},
				],
			}),
		).toEqual([]);
	});

	it("accepts named arms with pair gates", () => {
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
							gates: [
								{ metric: "tokens", winner: "skel-clean", loser: "none-clean" },
								{ metric: "tokens", winner: "skel-messy", loser: "none-messy" },
							],
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects the removed compare.cheaper field", () => {
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
		} as never);
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

	it("rejects a gate with an unknown arm", () => {
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
						gates: [{ metric: "tokens", winner: "skel-clean", loser: "missing" }],
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.gates[0].loser")).toBe(true);
	});

	it("accepts absolute gates and per-arm judge metrics", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						prompt: "Test the two paths.",
						compare: {
							a: { description: "Uses the first path." },
							b: { description: "Uses the second path." },
							judgeMetrics: [{ id: "clear", question: "Is the answer clear?" }],
							gates: [
								{ metric: "outcome", arm: "a", operator: "equal", value: "pass" },
								{ metric: "judge:clear", winner: "a", loser: "b" },
							],
						},
						rubric: {},
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects a judge gate with no matching judge metric", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad",
			scenarios: [
				{
					name: "pair",
					prompt: "Test the two paths.",
					compare: {
						a: { description: "Uses the first path." },
						b: { description: "Uses the second path." },
						gates: [{ metric: "judge:missing", winner: "a", loser: "b" }],
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.field === "compare.gates[0].metric")).toBe(true);
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

	it("accepts host-native context when the workspace owns all context", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "native",
				defaults: { contextMode: "host-native", skills: "none" },
				scenarios: [{ name: "case", prompt: "test", rubric: {} }],
			}),
		).toEqual([]);
	});

	it("rejects contextSources and synthetic skills for a host-native scenario", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad-native",
			scenarios: [
				{
					name: "case",
					prompt: "test",
					contextMode: "host-native",
					contextSources: ["brief.md"],
					skills: [".agents/skills/probe/SKILL.md"],
					rubric: {},
				},
			],
		});
		expect(issues.filter((issue) => issue.field === "contextMode")).toHaveLength(2);
	});

	it("rejects synthetic help inherited by a host-native compare arm", () => {
		const issues = validateSuiteFile("/tmp/scenarios.json", {
			name: "bad-arm",
			defaults: { skills: [".agents/skills/probe/SKILL.md"] },
			scenarios: [
				{
					name: "pair",
					prompt: "test",
					compare: {
						a: { description: "native", contextMode: "host-native" },
						b: { description: "preamble" },
					},
					rubric: {},
				},
			],
		});
		expect(issues.some((issue) => issue.message.includes("synthetic catalog"))).toBe(true);
	});
});
