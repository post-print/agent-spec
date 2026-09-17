import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, statistics, z } from "@post-print/agent-test";
import { releaseSkills, taskService } from "./agents.js";

const RUN_TESTS = /\bbun test\b/;
const GET_TASK = /get_task/;
const SEARCH_TASKS = /search_tasks/;
const LOCAL_TOOLS = /^(Read|Shell|Bash)$/;
// agent-test.config.ts selects OpenAI for coding and reviewing, with the task-list fixture.
// Each run starts independently; the enclosing test owns session/workspace cleanup.
// Skill and workspace source paths resolve against the config directory.
const test = describe("task-list tour", ({ agent, judge }) => ({
	coder: agent(),
	fileLookup: agent(),
	taskIndexLookup: agent({ mcpServers: { tasks: taskService } }),
	releaseWriter: agent({
		skills: releaseSkills,
		workspace: "agent-suites/fixtures/task-list-skill",
	}),
	repairReview: judge({
		prompt:
			"Evaluate the supplied source against the requirements. Check whether behavior is correct and changes are limited to the allowed files.",
		schema: z.object({
			behaviorCorrect: z.boolean(),
			changesWithinScope: z.boolean(),
			reason: z.string(),
		}),
	}),
	answerReview: judge({
		prompt: "Check whether each answer gives the reference date.",
		schema: z.object({
			fileAnswerCorrect: z.boolean(),
			indexAnswerCorrect: z.boolean(),
			reason: z.string(),
		}),
	}),
}));
test("answers from the project guide", async ({ coder }) => {
	const run = await coder.run({
		prompt: "Read PROJECT.md. Who owns this project? Reply with one short sentence.",
	});
	expect(run.output).toContain("Mina");
	expect(run).toHaveAccessedPath("PROJECT.md");
});
test("starts independent tasks and explicitly continues one", async ({ coder }) => {
	const prompt = "Read PROJECT.md and name the project owner.";
	const [firstTask, separateTask] = await Promise.all([
		coder.run({ prompt }),
		coder.run({ prompt }),
	]);
	expect(firstTask.workspace.root).not.toBe(separateTask.workspace.root);
	const followUp = await firstTask.continue({
		prompt: "Repeat the owner's name from your previous answer.",
	});
	expect(followUp.workspace.root).toBe(firstTask.workspace.root);
	expect(followUp.output).toContain("Mina");
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
test("repairs and grades the status bug", async ({ coder, repairReview }) => {
	const run = await coder.run({
		prompt:
			"Repair the status bug in src/status.ts. Change only that source file. Run bun test. End with TASK_STATUS_FIXED.",
	});
	expect(run.output).toContain("TASK_STATUS_FIXED");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS, exitCode: 0 });
	expect(run.workspace.changedPaths).toEqual(["src/status.ts"]);
	const evaluation = await repairReview.run({
		input: {
			source: await readFile(join(run.workspace.final.path, "src/status.ts"), "utf8"),
			changedPaths: run.workspace.changedPaths,
			allowedFiles: ["src/status.ts"],
			requirements: ["A task with completedAt is done.", "A task without completedAt is open."],
		},
	});
	expect(evaluation.output.behaviorCorrect).toBe(true);
	expect(evaluation.output.changesWithinScope).toBe(true);
});
test("uses the issue service", async ({ taskIndexLookup }) => {
	const run = await taskIndexLookup.run({
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
// search_tasks exposes a stale summary; get_task returns the current authoritative date.
test("compares three MCP workflows", async ({ taskIndexLookup }) => {
	const [summary, searched, direct] = await Promise.all([
		taskIndexLookup.run({
			prompt: "Call search_tasks for TASK-104. Use only that result. Reply with the due date only.",
		}),
		taskIndexLookup.run({
			prompt:
				"Call search_tasks for TASK-104, then get_task with that ID. Reply with the current due date only.",
		}),
		taskIndexLookup.run({
			prompt: "Call get_task with TASK-104. Reply with the current due date only.",
		}),
	]);
	expect(summary.output).not.toContain("2026-09-24");
	expect(searched.output).toContain("2026-09-24");
	expect(direct.output).toContain("2026-09-24");
	expect(direct.toolCalls.length).toBeLessThan(searched.toolCalls.length);
	expect(searched).toHaveCalledToolsInOrder([SEARCH_TASKS, GET_TASK]);
});
// Both individual task files and task_index contain authoritative due dates.
test("the task index preserves accuracy with fewer tokens", async ({
	fileLookup,
	taskIndexLookup,
	answerReview,
}) => {
	const samples = [];
	// Two repetitions illustrate aggregation, not a reliable efficiency advantage.
	for (let repetition = 0; repetition < 2; repetition++) {
		const [fileRun, indexRun] = await Promise.all([
			fileLookup.run({
				prompt:
					"Read records/TASK-101.md through records/TASK-104.md separately. Return the current due date for TASK-104.",
			}),
			taskIndexLookup.run({
				prompt: "Use task_index to find TASK-104. Return its current due date.",
			}),
		]);
		const review = await answerReview.run({
			input: {
				fileAnswer: fileRun.output,
				indexAnswer: indexRun.output,
				referenceDate: "2026-09-24",
			},
		});
		expect(review.output.fileAnswerCorrect).toBe(true);
		expect(review.output.indexAnswerCorrect).toBe(true);
		samples.push({ fileRun, indexRun });
	}
	const fileTokens = statistics(samples.map(({ fileRun }) => fileRun.usage.tokens.total));
	const indexTokens = statistics(samples.map(({ indexRun }) => indexRun.usage.tokens.total));
	expect(indexTokens.mean).toBeLessThan(fileTokens.mean);
	const fileCalls = statistics(samples.map(({ fileRun }) => fileRun.toolCalls.length));
	const indexCalls = statistics(samples.map(({ indexRun }) => indexRun.toolCalls.length));
	expect(indexCalls.mean).toBeLessThan(fileCalls.mean);
});
