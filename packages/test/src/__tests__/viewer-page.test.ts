import { describe, expect, it } from "bun:test";

import type { ViewerCatalog } from "../viewer/catalog.js";
import { renderViewerPage } from "../viewer/page.js";

const threeHostCatalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "tools",
			description: "A focused tool-use test suite.",
			hosts: ["cursor", "claude", "openai"],
			scenarios: [
				{
					name: "needle",
					prompt: "Read needle.txt.",
					rubric: {
						must: ["REPAIR_OK"],
						mustRunSuccessfully: ["bun test"],
						allowedCommands: ["bun test", "git diff"],
						mustReadPath: ["needle.txt"],
					},
				},
			],
		},
	],
};

const fourArmCatalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "judge",
			hosts: ["cursor"],
			scenarios: [
				{
					name: "four arms",
					prompt: "Read word.txt. Reply with only that word.",
					rubric: {
						mustReadPath: ["word.txt"],
						judge: ["Which arm gives the safer complete answer?"],
					},
					suppliedMcp: [{ name: "tasks", tools: ["search_tasks", "get_task"] }],
					suppliedSkills: [".agents/skills/catalog/SKILL.md"],
					compare: [
						{
							id: "skel-clean",
							label: "skeleton clean",
							prompt: "Read clean.txt with Skeleton.",
							rubric: { mustReadPath: ["word.txt"], must: ["CLEAN"] },
							suppliedMcp: [{ name: "tasks", tools: ["search_tasks", "get_task"] }],
							suppliedSkills: [".agents/skills/catalog/SKILL.md"],
						},
						{
							id: "none-clean",
							label: "no skill clean",
							prompt: "Read clean.txt without a skill.",
							rubric: { mustReadPath: ["word.txt"] },
						},
						{
							id: "skel-messy",
							label: "skeleton messy",
							prompt: "Read messy.txt with Skeleton.",
							rubric: { mustReadPath: ["word.txt"] },
						},
						{
							id: "none-messy",
							label: "no skill messy",
							prompt: "Read messy.txt without a skill.",
							rubric: { mustReadPath: ["word.txt"] },
						},
					],
					judgeMetrics: [{ id: "safe", question: "Is this answer safe and factually current?" }],
					gates: [{ metric: "turns", winner: "skel-clean", loser: "none-messy" }],
				},
			],
		},
	],
};

describe("viewer page", () => {
	it("renders host tabs and an inline result hook", () => {
		const html = renderViewerPage(threeHostCatalog);
		expect(html).toContain("host-tablist");
		expect(html).toContain("A focused tool-use test suite.");
		expect(html).toContain('class="suite-description"');
		expect(html).toContain("Run host");
		expect(html).toContain("syncScenarioHostChoices");
		expect(html).toContain("Reply");
		expect(html).toContain("Final reply must include <code>REPAIR_OK</code>.");
		expect(html).toContain("Required commands");
		expect(html).toContain("<code>bun test</code> successfully.");
		expect(html).toContain("Allowed commands");
		expect(html).toContain(
			'<code>bun test</code><span aria-hidden="true">, </span><code>git diff</code>',
		);
		expect(html).not.toContain("Every shell command must match one of these patterns.");
		expect(html).toContain('data-scenario-card="tools::needle"');
		expect(html).toContain("selectHostTab");
		expect(html).toContain("cell-result");
		expect(html).toContain("Start test");
		expect(html).toContain("Stop test");
		expect(html).toContain('id="parallel-hosts" checked');
		expect(html).not.toContain("Run configuration");
		expect(html).not.toContain('class="run-settings"');
		expect(html).toContain('data-host-panel="cursor"');
		expect(html).toContain('data-host-panel="openai"');
		expect(html).toContain("No run yet.");
		expect(html).toContain('id="run-history"');
		expect(html).toContain("selectRun");
		expect(html).toContain("bootstrap-data");
		expect(html).not.toContain('class="matrix"');
	});

	it("embeds the arm tab switcher and run progress", () => {
		const html = renderViewerPage(fourArmCatalog);
		expect(html).toContain("skeleton clean");
		expect(html).toContain("no skill messy");
		expect(html).toContain("Comparison pass criteria");
		expect(html).toContain('class="test-intent comparison-task"');
		const comparisonTask = html.slice(
			html.indexOf('class="test-intent comparison-task"'),
			html.indexOf('class="comparison-criteria"'),
		);
		expect(comparisonTask).toContain("Comparison task");
		expect(comparisonTask).not.toContain("Supplied MCP servers");
		expect(html).toContain("Supplied MCP servers");
		expect(html).toContain("Supplied MCP tools");
		expect(html).toContain("Supplied skills");
		expect(html).toContain("<code>search_tasks</code>");
		expect(html).toContain("<code>.agents/skills/catalog/SKILL.md</code>");
		expect(html).toContain("Each arm runs independently");
		expect(html).toContain("Acceptable behavior");
		expect(html).toContain("The same questions are judged separately for every arm.");
		expect(html).toContain("Is this answer safe and factually current?");
		expect(html).toContain("Comparison judge");
		expect(html).toContain("Which arm gives the safer complete answer?");
		expect(html).toContain("skeleton clean must use fewer turns than no skill messy.");
		expect(html).toContain('data-compare-arm-definition="skel-clean"');
		expect(html).toContain('aria-label="Comparison arm definitions"');
		expect(html).toContain('for="cd-judge-four-arms-skel-clean"');
		expect(html).toContain(
			'.cd-judge-four-arms:has(#cd-judge-four-arms-skel-clean:checked) [data-compare-arm-definition="skel-clean"]{display:block}',
		);
		expect(html).toContain("Read clean.txt with Skeleton.");
		expect(html).toContain("Final reply must include <code>CLEAN</code>.");
		expect(html).not.toContain("The scenario passes when it completes without a runner error.");
		expect(html).toContain("compare-tablist");
		expect(html).toContain("selectCompareTab");
		expect(html).toContain("dataset.userPicked");
		expect(html).toContain("compare-tabs");
		expect(html).toContain('id="run-progress"');
		expect(html).toContain("recordProgress");
		expect(html).toContain("displayToolPath");
		expect(html).toContain("chat-running");
		expect(html).toContain("hideAllRunning");
		expect(html).toContain("appendContextFiles");
		expect(html).toContain("appendContextPanel");
		expect(html).toContain("Context delivery");
		expect(html).toContain("Exact submitted user input");
		expect(html).toContain("context-why");
		expect(html.split("scrollIntoView").length - 1).toBe(1);
		expect(html).toContain("dataset.followHost");
		expect(html).toContain("startChat");
		expect(html).toContain("closeAllChats");
		expect(html).toContain("cancelOpenChats");
		expect(html).toContain("Stopping the run.");
		expect(html).toContain("Run cancelled.");
		expect(html).toContain("chatIsOpen");
		expect(html).toContain("Copy error");
		expect(html).toContain("installCopyErrorButtons");
	});
});
