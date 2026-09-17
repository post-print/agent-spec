import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { defineJudge, expect, test } from "@post-print/agent-test";
import { reviewer, withReleaseSkill, withTaskService } from "../tour/agents.js";

const exec = promisify(execFile);
const TOOLS = /Read|Shell|Bash|Write|Edit/;
const RUN_TESTS = /\bbun test\b/;
const SEARCH = /search_tasks/;
const GET = /get_task/;

test("scores required and forbidden reply text", async ({ agent }) => {
	const run = await agent.run("Reply with exactly: REPLY_SCORING_OK");
	expect(run.output).toBe("REPLY_SCORING_OK");
	expect(run.output).not.toContain("REPLY_SCORING_BAD");
});
test("scores forbidden tool calls", async ({ agent }) => {
	const run = await agent.run("Reply with exactly: NO_TOOLS_OK. Do not use tools.");
	expect(run.output).toContain("NO_TOOLS_OK");
	expect(run).not.toHaveCalledTool(TOOLS);
});
test("captures required and forbidden file access", async ({ agent }) => {
	const run = await agent.run(
		"Read PROJECT.md. Reply with the next task ID only. Do not read records/TASK-101.md.",
	);
	expect(run.output).toContain("TASK-104");
	expect(run).toHaveAccessedPath("PROJECT.md");
	expect(run).not.toHaveAccessedPath("records/TASK-101.md");
});
test("captures writes and successful shell commands", async ({ agent }) => {
	const run = await agent.run(
		"Repair the status bug in src/status.ts. Change only that source file. Run bun test. End with WRITE_COMMAND_OK.",
	);
	expect(run.output).toContain("WRITE_COMMAND_OK");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
});
test("captures ordered MCP tool calls", async ({ compare, agentDefinition }) => {
	const result = await compare({
		prompt:
			"Call search_tasks for TASK-104. Then call get_task with TASK-104. Reply with the current due date only.",
		variants: { service: { agent: withTaskService(agentDefinition) } },
	});
	expect(result.runs[0].output).toContain("2026-09-24");
	expect(result.runs[0]).toHaveCalledToolsInOrder([SEARCH, GET]);
});
test("injects provided context", async ({ compare, agentDefinition }) => {
	if (!agentDefinition) throw new Error("Select a configured project");
	const configured = {
		...agentDefinition,
		options: {
			...agentDefinition.options,
			context: { files: ["agent-suites/fixtures/task-list/brief.md"] },
		},
	};
	const result = await compare({
		prompt: "Reply with the support code from the provided context. Do not use tools.",
		variants: { configured: { agent: configured } },
	});
	expect(result.runs[0].output).toContain("BLUE-417");
	expect(result.runs[0]).not.toHaveCalledTool(TOOLS);
});
test("applies setup changes before the agent starts", async ({ agent, workspace }) => {
	// Standard fixture setup owns seeding; no second scenario runner is needed.
	const patch = new URL("../fixtures/task-list/seed.patch", import.meta.url);
	const patchText = await readFile(patch, "utf8");
	const patchFile = `${workspace.path}/setup.patch`;
	await writeFile(patchFile, patchText);
	await exec("git", ["apply", patchFile], { cwd: workspace.path });
	await rm(patchFile);
	const run = await agent.run("Read seeded.txt. Reply with its exact value.");
	expect(run.output).toContain("SEED-READY");
});
test("isolates a scenario workspace", async ({ agent }) => {
	const run = await agent.run("List the names at the workspace root. Reply with names only.");
	expect(run.output).toContain("PROJECT.md");
	expect(run.workspace.initial.files["packages/test/package.json"]).toBeUndefined();
});
test("loads a supplied skill", async ({ compare, agentDefinition }) => {
	const result = await compare({
		prompt: "Use the release-note skill. Return only the release note.",
		variants: {
			skilled: {
				agent: withReleaseSkill(agentDefinition),
				workspace: "agent-suites/fixtures/task-list-skill",
			},
		},
	});
	expect(result.runs[0].output).toContain("RELEASE: TASK-104 is ready.");
	const skill = result.runs[0].startingContext.skills[0];
	expect(skill).toBeDefined();
	expect(result.runs[0]).toHaveAccessedPath(`${skill.destination}/SKILL.md`);
});
test("grades a qualitative recommendation", async ({ agent }) => {
	const run = await agent.run(
		"A teammate wants to ship today because tests pass, but there is no rollback plan. Give a concise recommendation balancing urgency and operational risk.",
	);
	const grade = await run.judge(
		defineJudge({
			agent: reviewer,
			criteria: {
				balance: {
					description:
						"Is the recommendation clear, proportionate, and actionable given the missing rollback plan?",
					scores: {
						0: "Ignores the risk or gives no practical next step",
						1: "Explains the risk and gives a proportionate next step",
					},
				},
			},
		}),
	);
	expect(grade.scores.balance).toBe(1);
});
test("accepts a declared failed comparison control", async ({ compare }) => {
	const result = await compare({
		prompt: "Reply with exactly: CAPABILITY_COMPARE_OK",
		variants: {
			control: { prompt: "Reply with exactly: CAPABILITY_CONTROL", expectedFailures: ["answer"] },
			candidate: {},
		},
		checks: async (run, check) => {
			await check("answer", () => expect(run.output).toContain("CAPABILITY_COMPARE_OK"));
		},
	});
	expect(result.runs).toHaveLength(2);
});
