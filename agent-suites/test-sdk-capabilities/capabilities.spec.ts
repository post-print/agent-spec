import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, z } from "@post-print/agent-test";
import { releaseSkills, taskService } from "../tour/agents.js";

// The default configuration uses OpenAI and copies the task-list sample project for each run.
// Skill, context, and workspace paths start from the directory that contains the configuration file.
const test = describe("Agent test checks", ({ agent, judge }) => ({
	agent: agent(),
	seeded: agent().setup(async (workspace) => {
		await writeFile(join(workspace.path, "seeded.txt"), "SEED-READY", "utf8");
	}),
	service: agent({ mcpServers: { tasks: taskService } }),
	skilled: agent({ skills: releaseSkills, workspace: "agent-suites/fixtures/task-list-skill" }),
	releaseAdvice: judge({
		prompt:
			"Does the answer explain the risk of releasing without a way to undo the change? Does it suggest a practical next step?",
		schema: z.object({
			explainsRisk: z.boolean(),
			suggestsNextStep: z.boolean(),
			reason: z.string(),
		}),
	}),
}));
const RUN_TESTS = /\bbun test\b/;
const SEARCH = /search_tasks/;
const GET = /get_task/;

test("checks that a reply has the required text and leaves out forbidden text", async ({
	agent,
}) => {
	const run = await agent.run({ prompt: "Reply with exactly: READY" });
	expect(run.output).toBe("READY");
	expect(run.output).not.toContain("ERROR");
});
test("answers without using tools", async ({ agent }) => {
	const run = await agent.run({ prompt: "Reply with exactly: READY. Do not use tools." });
	expect(run.output).toContain("READY");
	expect(run.toolCalls).toEqual([]);
});
test("reads the requested file and leaves the forbidden file alone", async ({ agent }) => {
	const run = await agent.run({
		prompt: "Read PROJECT.md. Reply with the next task ID only. Do not read records/TASK-101.md.",
	});
	expect(run.output).toContain("TASK-104");
	expect(run).toHaveReadPath("PROJECT.md");
	expect(run).not.toHaveAccessedPath("records/TASK-101.md");
});
test("changes only the requested file and runs the tests successfully", async ({ agent }) => {
	const run = await agent.run({
		prompt:
			"Fix the status bug in src/status.ts. Change only that source file. Run bun test. End with WRITE_COMMAND_OK.",
	});
	expect(run.output).toContain("WRITE_COMMAND_OK");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
});
test("searches for a task before reading its details", async ({ service }) => {
	const run = await service.run({
		prompt:
			"Call search_tasks for TASK-104. Then call get_task with TASK-104. Reply with the current due date only.",
	});
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledToolsInOrder([SEARCH, GET]);
});
test("answers from an attached note without using tools", async ({ agent }) => {
	const run = await agent.run({
		prompt: "Reply with the support code from the attached note. Do not use tools.",
		context: { files: ["agent-suites/fixtures/task-list/brief.md"] },
	});
	expect(run.output).toContain("BLUE-417");
	expect(run.toolCalls).toEqual([]);
});
test("prepares the workspace before the agent starts", async ({ seeded }) => {
	const run = await seeded.run({ prompt: "Read seeded.txt and reply with its exact contents." });
	// The initial snapshot includes the file that setup wrote, before the agent runs.
	expect(run.workspace.initial.files["seeded.txt"]).toBeDefined();
	expect(run.output).toBe("SEED-READY");
});
test("starts with sample project files and leaves out the SDK package file", async ({ agent }) => {
	const run = await agent.run({
		prompt: "List the names at the workspace root. Reply with names only.",
	});
	expect(run.output).toContain("PROJECT.md");
	expect(run.workspace.initial.files["PROJECT.md"]).toBeDefined();
	expect(run.workspace.initial.files["packages/test/package.json"]).toBeUndefined();
});
// The skill says to read PROJECT.md and return only the release note from that file.
test("reads the attached skill and returns its release note", async ({ skilled }) => {
	const run = await skilled.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	expect(run.output).toBe("RELEASE: TASK-104 is ready.");
	expect(run).toHaveReadPath("PROJECT.md");
	expect(run).toHaveReadPath(`${run.startingContext.skills[0].destination}/SKILL.md`);
});
test("asks a judge whether release advice explains the risk and a next step", async ({
	agent,
	releaseAdvice,
}) => {
	const run = await agent.run({
		prompt:
			"A teammate wants to release today because tests pass. There is no plan to undo the release if it fails. What do you recommend?",
	});
	const evaluation = await releaseAdvice.run({ input: { task: run.prompt, answer: run.output } });
	expect(evaluation.output.explainsRisk).toBe(true);
	expect(evaluation.output.suggestsNextStep).toBe(true);
});
test("checks one required answer against two different replies", async ({ agent }) => {
	const [wrongAnswer, correctAnswer] = await Promise.all([
		agent.run({ prompt: "Reply with exactly: NO" }),
		agent.run({ prompt: "Reply with exactly: YES" }),
	]);
	// Both agents follow their prompts. Only YES meets this test's answer requirement.
	expect(wrongAnswer.output).toBe("NO");
	expect(wrongAnswer.output).not.toBe("YES");
	expect(correctAnswer.output).toBe("YES");
});
