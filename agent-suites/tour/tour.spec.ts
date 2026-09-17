import { defineJudge, expect, test } from "@post-print/agent-test";
import { repairJudge, reviewer, withReleaseSkill, withTaskService } from "./agents.js";

const RUN_TESTS = /\bbun test\b/;
const GET_TASK = /get_task/;
const SEARCH_TASKS = /search_tasks/;
const LOCAL_TOOLS = /^(Read|Shell|Bash)$/;

test("answers from the project guide", async ({ agent }) => {
	const run = await agent.run(
		"Read PROJECT.md. Who owns this project? Reply with one short sentence.",
	);
	expect(run.output).toContain("Mina");
	expect(run).toHaveAccessedPath("PROJECT.md");
});

test("finds the cause of a status bug", async ({ agent }) => {
	const run = await agent.run(
		"Find the cause of the failing status test. Read the source and test, run bun test, and explain the cause. Do not change files.",
	);
	expect(run.output).toContain("completedAt");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS });
	expect(run.workspace.changedPaths).toEqual([]);
});

test("repairs and grades the status bug", async ({ agent }) => {
	const run = await agent.run(
		"Repair the status bug in src/status.ts. Change only that source file. Run bun test. End with TASK_STATUS_FIXED.",
	);
	expect(run.output).toContain("TASK_STATUS_FIXED");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
	const grade = await run.judge(repairJudge);
	expect(grade.scores.correctness).toBe(2);
	expect(grade.scores.scope).toBe(1);
});

test("uses the issue service", async ({ compare, agentDefinition }) => {
	const comparison = await compare({
		prompt:
			"Call get_task with TASK-104. Reply with its current due date in YYYY-MM-DD format only. Do not use file or shell tools.",
		variants: { service: { agent: withTaskService(agentDefinition) } },
	});
	const [run] = comparison.variants.service.runs;
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledTool(GET_TASK);
	expect(run).not.toHaveCalledTool(LOCAL_TOOLS);
});

test("follows an attached release skill", async ({ compare, agentDefinition }) => {
	const comparison = await compare({
		prompt: "Use the release-note skill. Return only the release note.",
		variants: {
			skilled: {
				agent: withReleaseSkill(agentDefinition),
				workspace: "agent-suites/fixtures/task-list-skill",
			},
		},
	});
	const [run] = comparison.variants.skilled.runs;
	expect(run.output).toContain("RELEASE: TASK-104 is ready.");
	expect(run).toHaveAccessedPath("PROJECT.md");
});

test("compares three MCP workflows", async ({ compare, agentDefinition }) => {
	const service = withTaskService(agentDefinition);
	const comparison = await compare({
		prompt: "Find the current due date for TASK-104.",
		variants: {
			summaryOnly: {
				agent: service,
				prompt:
					"Call search_tasks for TASK-104. Use only that result. Reply with the due date only.",
				expectedFailures: ["current-date"],
			},
			searchThenDetail: {
				agent: service,
				prompt:
					"Call search_tasks for TASK-104, then get_task with that ID. Reply with the current due date only.",
			},
			directDetail: {
				agent: service,
				prompt: "Call get_task with TASK-104. Reply with the current due date only.",
			},
		},
		checks: async (run, check) => {
			await check("current-date", () => expect(run.output).toContain("2026-09-24"));
		},
	});
	expect(comparison.variants.directDetail.metrics.toolCalls.mean).toBeLessThan(
		comparison.variants.searchThenDetail.metrics.toolCalls.mean,
	);
	expect(comparison.variants.searchThenDetail.runs[0]).toHaveCalledToolsInOrder([
		SEARCH_TASKS,
		GET_TASK,
	]);
});

test("measures tool usage and independently grades each variant", async ({
	compare,
	agentDefinition,
}) => {
	const comparison = await compare({
		prompt:
			"Find the current due date for TASK-104. Use task_index if available; otherwise read records/TASK-101.md through records/TASK-104.md separately. Reply with the date only.",
		variants: {
			baseline: { repeat: 2 },
			withTool: { agent: withTaskService(agentDefinition), repeat: 2 },
		},
	});
	const grade = await comparison.judge(
		defineJudge({
			agent: reviewer,
			criteria: {
				correctness: {
					description: "Does the answer give the authoritative current due date?",
					scores: {
						0: "Wrong or unsupported date.",
						1: "Correct date grounded in authoritative evidence.",
					},
				},
			},
			context: { reference: { text: "The current due date for TASK-104 is 2026-09-24." } },
		}),
	);
	for (const result of grade.variants.withTool.runs) expect(result.scores.correctness).toBe(1);
	expect(comparison.variants.withTool.metrics.toolCalls.mean).toBeLessThan(
		comparison.variants.baseline.metrics.toolCalls.mean,
	);
	// Missing usage is an explicit failure, never a zero-token win.
	expect(comparison.variants.withTool.metrics.tokens.total.mean).toBeLessThan(
		comparison.variants.baseline.metrics.tokens.total.mean,
	);
});
