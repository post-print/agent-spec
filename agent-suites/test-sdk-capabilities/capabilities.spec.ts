import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, z } from "@post-print/agent-test";
import { releaseSkills, taskService } from "../tour/agents.js";

// Defaults come from agent-test.config.ts: OpenAI coder/reviewer and the task-list fixture.
// Skill, context, and workspace source paths resolve against that config directory.
const test = describe("SDK capabilities", ({ agent, judge }) => ({
	agent: agent(),
	seeded: agent().setup(async (workspace) => {
		await writeFile(join(workspace.path, "seeded.txt"), "SEED-READY", "utf8");
	}),
	service: agent({ mcpServers: { tasks: taskService } }),
	skilled: agent({ skills: releaseSkills, workspace: "agent-suites/fixtures/task-list-skill" }),
	balance: judge({
		prompt:
			"Does the recommendation explain the missing rollback risk and offer a proportionate practical next step?",
		schema: z.object({ balanced: z.boolean(), reason: z.string() }),
	}),
}));
const TOOLS = /Read|Shell|Bash|Write|Edit/;
const RUN_TESTS = /\bbun test\b/;
const SEARCH = /search_tasks/;
const GET = /get_task/;

test("scores required and forbidden reply text", async ({ agent }) => {
	const run = await agent.run({ prompt: "Reply with exactly: REPLY_SCORING_OK" });
	expect(run.output).toBe("REPLY_SCORING_OK");
	expect(run.output).not.toContain("REPLY_SCORING_BAD");
});
test("scores forbidden tool calls", async ({ agent }) => {
	const run = await agent.run({ prompt: "Reply with exactly: NO_TOOLS_OK. Do not use tools." });
	expect(run.output).toContain("NO_TOOLS_OK");
	expect(run).not.toHaveCalledTool(TOOLS);
});
test("captures required and forbidden file access", async ({ agent }) => {
	const run = await agent.run({
		prompt: "Read PROJECT.md. Reply with the next task ID only. Do not read records/TASK-101.md.",
	});
	expect(run.output).toContain("TASK-104");
	expect(run).toHaveAccessedPath("PROJECT.md");
	expect(run).not.toHaveAccessedPath("records/TASK-101.md");
});
test("captures writes and successful shell commands", async ({ agent }) => {
	const run = await agent.run({
		prompt:
			"Repair the status bug in src/status.ts. Change only that source file. Run bun test. End with WRITE_COMMAND_OK.",
	});
	expect(run.output).toContain("WRITE_COMMAND_OK");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
});
test("captures ordered MCP tool calls", async ({ service }) => {
	const run = await service.run({
		prompt:
			"Call search_tasks for TASK-104. Then call get_task with TASK-104. Reply with the current due date only.",
	});
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledToolsInOrder([SEARCH, GET]);
});
test("injects provided context", async ({ agent }) => {
	const run = await agent.run({
		prompt: "Reply with the support code from the provided context. Do not use tools.",
		context: { files: ["agent-suites/fixtures/task-list/brief.md"] },
	});
	expect(run.output).toContain("BLUE-417");
	expect(run).not.toHaveCalledTool(TOOLS);
});
test("prepares the workspace before the agent starts", async ({ seeded }) => {
	const run = await seeded.run({ prompt: "Read seeded.txt and reply with its exact contents." });
	// Initial evidence includes setup changes, before any agent activity.
	expect(run.workspace.initial.files["seeded.txt"]).toBeDefined();
	expect(run.output).toBe("SEED-READY");
});
test("isolates a scenario workspace", async ({ agent }) => {
	const run = await agent.run({
		prompt: "List the names at the workspace root. Reply with names only.",
	});
	expect(run.output).toContain("PROJECT.md");
	expect(run.workspace.initial.files["packages/test/package.json"]).toBeUndefined();
});
test("loads a supplied skill", async ({ skilled }) => {
	const run = await skilled.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	expect(run.output).toContain("RELEASE: TASK-104 is ready.");
	expect(run).toHaveAccessedPath(`${run.startingContext.skills[0].destination}/SKILL.md`);
});
test("grades a qualitative recommendation", async ({ agent, balance }) => {
	const run = await agent.run({
		prompt:
			"A teammate wants to ship today because tests pass, but there is no rollback plan. Give a concise recommendation balancing urgency and operational risk.",
	});
	const evaluation = await balance.run({ input: { task: run.prompt, answer: run.output } });
	expect(evaluation.output.balanced).toBe(true);
});
test("asserts an intentionally incorrect control", async ({ agent }) => {
	const [control, candidate] = await Promise.all([
		agent.run({ prompt: "Reply with exactly: CAPABILITY_CONTROL" }),
		agent.run({ prompt: "Reply with exactly: CAPABILITY_COMPARE_OK" }),
	]);
	expect(control.output).not.toContain("CAPABILITY_COMPARE_OK");
	expect(candidate.output).toContain("CAPABILITY_COMPARE_OK");
});
