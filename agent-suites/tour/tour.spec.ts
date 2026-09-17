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
		prompt:
			"Check whether all four labeled answers give the reference date. Return one correctness result for each label.",
		schema: z.object({
			fileRoundOneCorrect: z.boolean(),
			indexRoundOneCorrect: z.boolean(),
			fileRoundTwoCorrect: z.boolean(),
			indexRoundTwoCorrect: z.boolean(),
			reason: z.string(),
		}),
	}),
}));
test("reads the project owner from a file", {
	description:
		"The agent reads PROJECT.md and identifies Mina as the project owner. The test checks both the answer and the file read.",
	resources: ["coder"],
}, async ({ coder }) => {
	const run = await coder.run({
		prompt: "Read PROJECT.md. Who owns this project? Reply with one short sentence.",
	});
	expect(run.output).toContain("Mina");
	expect(run).toHaveReadPath("PROJECT.md");
});
test("starts separate tasks and remembers a message when a task continues", {
	description:
		"Two independent tasks must use separate workspaces. Continuing the first task must preserve its workspace and remember a code that the other task never received.",
	resources: ["coder"],
}, async ({ coder }) => {
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
test("runs the failing status test without changing files", {
	description:
		"The agent investigates the sample status bug, runs bun test, and mentions completedAt. The test requires the workspace to remain unchanged.",
	resources: ["coder"],
}, async ({ coder }) => {
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
test("fixes the status bug and asks a judge to review the change", {
	description:
		"The agent fixes src/status.ts and runs the tests. A separate judge reviews the supplied source and changed paths against the two task-status requirements.",
	resources: ["coder", "repairReview"],
}, async ({ coder, repairReview }) => {
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
test("gets a task date without calling Read, Shell, or Bash", {
	description:
		"The agent retrieves TASK-104 through the task service. The answer must contain September 24, 2026, without using file or shell tools.",
	resources: ["taskReader"],
}, async ({ taskReader }) => {
	const run = await taskReader.run({
		prompt:
			"Call get_task with TASK-104. Reply with its current due date in YYYY-MM-DD format only. Do not use file or shell tools.",
	});
	expect(run.output).toContain("2026-09-24");
	expect(run).toHaveCalledTool(GET_TASK);
	expect(run).not.toHaveCalledTool(LOCAL_TOOLS);
});
// The skill says to read PROJECT.md and return only the release note from that file.
test("reads a skill and follows its release note instructions", {
	description:
		"The agent reads the attached release-note skill and PROJECT.md, then returns exactly the release note stored in the project.",
	resources: ["releaseWriter"],
}, async ({ releaseWriter }) => {
	const run = await releaseWriter.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	expect(run.output).toBe("RELEASE: TASK-104 is ready.");
	expect(run).toHaveReadPath(`${run.startingContext.skills[0].destination}/SKILL.md`);
	expect(run).toHaveReadPath("PROJECT.md");
});
// Search returns an old date, September 20. The task details give the current date, September 24.
test("gets the current date from task details instead of an old search result", {
	description:
		"Three independent tasks use search only, search plus details, or details only. The test distinguishes the stale search date from the current task date and compares the tool calls.",
	resources: ["taskReader"],
}, async ({ taskReader }) => {
	const [searchOnly, searchThenDetails, detailsOnly] = await Promise.all([
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
	expect(searchOnly.output).toContain("2026-09-20");
	expect(searchOnly.output).not.toContain("2026-09-24");
	expect(searchOnly).toHaveCalledTool(SEARCH_TASKS);
	expect(searchOnly).not.toHaveCalledTool(GET_TASK);
	expect(detailsOnly).toHaveCalledTool(GET_TASK);
	expect(detailsOnly).not.toHaveCalledTool(SEARCH_TASKS);
	expect(searchThenDetails.output).toContain("2026-09-24");
	expect(detailsOnly.output).toContain("2026-09-24");
	expect(detailsOnly.toolCalls.length).toBeLessThan(searchThenDetails.toolCalls.length);
	expect(searchThenDetails).toHaveCalledToolsInOrder([SEARCH_TASKS, GET_TASK]);
});
// Both sources contain the current dates. This example compares two required methods.
// Reading four separate records adds work on purpose so we can compare it with one index lookup.
test("uses fewer tokens and tool calls for one index lookup than four file reads", {
	description:
		"Across two rounds, compare four separate file reads with one task-index lookup. One judge checks all four answers; assertions compare average token use and tool calls. Two rounds are illustrative, not statistical proof.",
	resources: ["fileLookup", "taskReader", "answerReview"],
}, async ({ fileLookup, taskReader, answerReview }) => {
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
		samples.push({ fileRun, indexRun });
	}
	const [roundOne, roundTwo] = samples;
	if (!roundOne || !roundTwo) throw new Error("Expected two comparison rounds");
	const review = await answerReview.run({
		input: {
			fileRoundOne: roundOne.fileRun.output,
			indexRoundOne: roundOne.indexRun.output,
			fileRoundTwo: roundTwo.fileRun.output,
			indexRoundTwo: roundTwo.indexRun.output,
			referenceDate: "2026-09-24",
		},
	});
	expect(review.output.fileRoundOneCorrect).toBe(true);
	expect(review.output.indexRoundOneCorrect).toBe(true);
	expect(review.output.fileRoundTwoCorrect).toBe(true);
	expect(review.output.indexRoundTwoCorrect).toBe(true);
	const fileTokens = statistics(samples.map(({ fileRun }) => fileRun.usage.tokens.total));
	const indexTokens = statistics(samples.map(({ indexRun }) => indexRun.usage.tokens.total));
	expect(indexTokens.mean).toBeLessThan(fileTokens.mean);
	const fileCalls = statistics(samples.map(({ fileRun }) => fileRun.toolCalls.length));
	const indexCalls = statistics(samples.map(({ indexRun }) => indexRun.toolCalls.length));
	expect(indexCalls.mean).toBeLessThan(fileCalls.mean);
});
