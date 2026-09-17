import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, statistics, z } from "@post-print/agent-test";
import { releaseSkills, taskRecordsMcp } from "./agents.js";

const RUN_TESTS = /\bbun test\b/;
const GET_TASK = /get_task/;
const TASK_INDEX = /task_index/;
const SEARCH_TASKS = /search_tasks/;
const LOCAL_TOOLS = /^(Read|Shell|Bash)$/;
// The default configuration uses OpenAI and copies the task-list sample project for each run.
// Each test closes its agents and removes their workspaces when it ends.
// Skill and workspace paths start from the directory that contains the configuration file.
const test = describe("Agent test examples", ({ agent, judge }) => ({
	coder: agent(),
	fileLookup: agent(),
	taskReader: agent({ mcpServers: { taskRecords: taskRecordsMcp } }),
	releaseWriter: agent({
		skills: releaseSkills,
		workspace: "agent-suites/fixtures/task-list-skill",
	}),
	repairReview: judge({
		prompt:
			"Read the supplied source. Does it meet both requirements? Did the agent change only the allowed files?",
		schema: z.object({
			behaviorCorrect: z.boolean(),
			onlyAllowedFilesChanged: z.boolean(),
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
test("reads the project owner from a file", async ({ coder }) => {
	const run = await coder.run({
		prompt: "Read PROJECT.md. Who owns this project? Reply with one short sentence.",
	});
	expect(run.output).toContain("Mina");
	expect(run).toHaveReadPath("PROJECT.md");
});
test("starts separate tasks and remembers a message when a task continues", async ({ coder }) => {
	const secret = randomUUID();
	const [firstTask, separateTask] = await Promise.all([
		coder.run({
			prompt: `Remember this code: ${secret}. Reply with the code only. Do not use tools.`,
		}),
		coder.run({ prompt: "Reply with READY. Do not use tools." }),
	]);
	expect(firstTask.workspace.root).not.toBe(separateTask.workspace.root);
	expect(firstTask.output).toBe(secret);
	// This code exists only in the first conversation. The follow-up does not repeat it.
	const followUp = await firstTask.continue({
		prompt: "What code did I ask you to remember? Reply with the code only. Do not use tools.",
	});
	expect(followUp.workspace.root).toBe(firstTask.workspace.root);
	expect(followUp.output).toBe(secret);
	expect(firstTask.toolCalls).toEqual([]);
	expect(followUp.toolCalls).toEqual([]);
});
test("explains the status bug without changing files", async ({ coder }) => {
	const run = await coder.run({
		prompt:
			"Find the cause of the failing status test. Read the source and test, run bun test, and explain the cause. Do not change files.",
	});
	// The sample code reverses the two states: completed tasks become open, and unfinished tasks become done.
	// This word check only shows that the answer mentions the relevant field. It does not grade the explanation.
	expect(run.output).toContain("completedAt");
	expect(run).toHaveExecutedCommand({ command: RUN_TESTS });
	expect(run.workspace.changedPaths).toEqual([]);
});
test("fixes the status bug and asks a judge to review the change", async ({
	coder,
	repairReview,
}) => {
	const run = await coder.run({
		prompt:
			"Fix the status bug in src/status.ts. Change only that source file. Run bun test. End with TASK_STATUS_FIXED.",
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
	expect(evaluation.output.onlyAllowedFilesChanged).toBe(true);
});
test("gets a task date from a tool without reading local files", async ({ taskReader }) => {
	const run = await taskReader.run({
		prompt:
			"Call get_task with TASK-104. Reply with its current due date in YYYY-MM-DD format only. Do not use file or shell tools.",
	});
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledTool(GET_TASK);
	expect(run).not.toHaveCalledTool(LOCAL_TOOLS);
});
// The skill says to read PROJECT.md and return only the release note from that file.
test("reads a skill and follows its release note instructions", async ({ releaseWriter }) => {
	const run = await releaseWriter.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	expect(run.output).toBe("RELEASE: TASK-104 is ready.");
	expect(run).toHaveReadPath(`${run.startingContext.skills[0].destination}/SKILL.md`);
	expect(run).toHaveReadPath("PROJECT.md");
});
// Search returns an old date, September 20. The task details give the current date, September 24.
test("gets the current date from task details instead of an old search result", async ({
	taskReader,
}) => {
	const [summary, searched, direct] = await Promise.all([
		taskReader.run({
			prompt: "Call search_tasks for TASK-104. Use only that result. Reply with the due date only.",
		}),
		taskReader.run({
			prompt:
				"Call search_tasks for TASK-104, then get_task with that ID. Reply with the current due date only.",
		}),
		taskReader.run({
			prompt: "Call get_task with TASK-104. Reply with the current due date only.",
		}),
	]);
	expect(summary.output).toContain("2026-09-20");
	expect(summary.output).not.toContain("2026-09-24");
	expect(summary).toHaveCalledTool(SEARCH_TASKS);
	expect(summary).not.toHaveCalledTool(GET_TASK);
	expect(direct).toHaveCalledTool(GET_TASK);
	expect(direct).not.toHaveCalledTool(SEARCH_TASKS);
	expect(searched.output).toContain("2026-09-24");
	expect(direct.output).toContain("2026-09-24");
	expect(direct.toolCalls.length).toBeLessThan(searched.toolCalls.length);
	expect(searched).toHaveCalledToolsInOrder([SEARCH_TASKS, GET_TASK]);
});
// Both sources contain the current dates. This example compares two required methods.
// Reading four separate records adds work on purpose so we can compare it with one index lookup.
test("compares tokens for four file reads and one task index lookup", async ({
	fileLookup,
	taskReader,
	answerReview,
}) => {
	const samples = [];
	// Two rounds show how to calculate an average. They do not prove that the index always uses fewer tokens.
	for (let repetition = 0; repetition < 2; repetition++) {
		const [fileRun, indexRun] = await Promise.all([
			fileLookup.run({
				prompt:
					"Read records/TASK-101.md through records/TASK-104.md separately. Return the current due date for TASK-104.",
			}),
			taskReader.run({
				prompt:
					"Call task_index once to find TASK-104. Return its current due date. Do not use other tools.",
			}),
		]);
		for (const id of ["TASK-101", "TASK-102", "TASK-103", "TASK-104"])
			expect(fileRun).toHaveReadPath(`records/${id}.md`);
		expect(indexRun).toHaveCalledTool(TASK_INDEX);
		expect(indexRun.toolCalls).toHaveLength(1);
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
