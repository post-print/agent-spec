import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, statistics } from "@post-print/agent-test";
import { answerEvaluation, releaseSkills, repairEvaluation, taskService } from "./agents.js";

const RUN_TESTS = /\bbun test\b/;
const GET_TASK = /get_task/;
const SEARCH_TASKS = /search_tasks/;
const LOCAL_TOOLS = /^(Read|Shell|Bash)$/;
const test = describe("task-list tour", ({ agent, judge }) => ({
	coder: agent(),
	service: agent({ mcpServers: { tasks: taskService } }),
	releaseWriter: agent({
		skills: releaseSkills,
		workspace: "agent-suites/fixtures/task-list-skill",
	}),
	repair: judge(repairEvaluation),
	accuracy: judge(answerEvaluation),
}));
test("answers from the project guide", async ({ coder }) => {
	const run = await coder.run({
		prompt: "Read PROJECT.md. Who owns this project? Reply with one short sentence.",
	});
	expect(run.output).toContain("Mina");
	expect(run).toHaveAccessedPath("PROJECT.md");
});
test("finds the cause of a status bug", async ({ coder }) => {
	const run = await coder.run({
		prompt:
			"Find the cause of the failing status test. Read the source and test, run bun test, and explain the cause. Do not change files.",
	});
	expect(run.output).toContain("completedAt");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS });
	expect(run.workspace.changedPaths).toEqual([]);
});
test("repairs and grades the status bug", async ({ coder, repair }) => {
	const run = await coder.run({
		prompt:
			"Repair the status bug in src/status.ts. Change only that source file. Run bun test. End with TASK_STATUS_FIXED.",
	});
	expect(run.output).toContain("TASK_STATUS_FIXED");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
	const evaluation = await repair.run({
		input: {
			source: await readFile(join(run.workspace.final.path, "src/status.ts"), "utf8"),
			changedPaths: run.workspace.changedPaths,
			requirements:
				"Completed tasks are done; tasks without completedAt are open. Only src/status.ts should change.",
		},
	});
	expect(evaluation.output.correctness).toBe(2);
	expect(evaluation.output.scope).toBe(1);
});
test("uses the issue service", async ({ service }) => {
	const run = await service.run({
		prompt:
			"Call get_task with TASK-104. Reply with its current due date in YYYY-MM-DD format only. Do not use file or shell tools.",
	});
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledTool(GET_TASK);
	expect(run).not.toHaveCalledTool(LOCAL_TOOLS);
});
test("follows an attached release skill", async ({ releaseWriter }) => {
	const run = await releaseWriter.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	expect(run.output).toContain("RELEASE: TASK-104 is ready.");
	expect(run).toHaveAccessedPath("PROJECT.md");
});
test("compares three MCP workflows", async ({ service }) => {
	const [summary, searched, direct] = await Promise.all([
		service.run({
			prompt: "Call search_tasks for TASK-104. Use only that result. Reply with the due date only.",
		}),
		service.run({
			prompt:
				"Call search_tasks for TASK-104, then get_task with that ID. Reply with the current due date only.",
		}),
		service.run({ prompt: "Call get_task with TASK-104. Reply with the current due date only." }),
	]);
	expect(summary.output).not.toContain("2026-09-24");
	expect(searched.output).toContain("2026-09-24");
	expect(direct.output).toContain("2026-09-24");
	expect(direct.toolCalls.length).toBeLessThan(searched.toolCalls.length);
	expect(searched).toHaveCalledToolsInOrder([SEARCH_TASKS, GET_TASK]);
});
test("measures tokens and judges selected outputs", async ({ coder, service, accuracy }) => {
	const prompt =
		"Find the current due date for TASK-104. Use task_index if available; otherwise read records/TASK-101.md through records/TASK-104.md separately. Reply with the date only.";
	const pairs = [];
	for (let i = 0; i < 2; i++)
		pairs.push(await Promise.all([coder.run({ prompt }), service.run({ prompt })]));
	for (const [baseline, candidate] of pairs) {
		const evaluation = await accuracy.run({
			input: { baseline: baseline.output, candidate: candidate.output, reference: "2026-09-24" },
		});
		expect(evaluation.output.baselineCorrect).toBe(true);
		expect(evaluation.output.candidateCorrect).toBe(true);
	}
	expect(statistics(pairs.map((pair) => pair[1].usage.tokens.total)).mean).toBeLessThan(
		statistics(pairs.map((pair) => pair[0].usage.tokens.total)).mean,
	);
	expect(statistics(pairs.map((pair) => pair[1].toolCalls.length)).mean).toBeLessThan(
		statistics(pairs.map((pair) => pair[0].toolCalls.length)).mean,
	);
});
