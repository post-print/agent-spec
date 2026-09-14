import { describe, expect, it } from "bun:test";
import type { AgentSuiteFile } from "../types.js";
import { validateSuiteFile } from "../validate-suite.js";

describe("validate-suite", () => {
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

	it("accepts a compare scenario without a judge", () => {
		expect(
			validateSuiteFile("/tmp/scenarios.json", {
				name: "ok",
				scenarios: [
					{
						name: "pair",
						prompt: "test",
						compare: {
							a: { label: "alpha", workspace: "agent-suites/judge/workspaces/compare-a" },
							b: { label: "beta", workspace: "agent-suites/judge/workspaces/compare-b" },
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
							a: { label: "alpha", workspace: "agent-suites/judge/workspaces/compare-a" },
							b: { label: "beta", workspace: "agent-suites/judge/workspaces/compare-b" },
						},
						rubric: { judge: ["Did the arms differ?"] },
					},
				],
			}),
		).toEqual([]);
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
