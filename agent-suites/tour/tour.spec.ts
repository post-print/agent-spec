import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, statistics, z } from "@post-print/agent-test";
import {
	RELEASE_SKILL_FIXTURE,
	REPO_ROOT,
	releaseSkills,
	runHiddenStatusTests,
	runStatusTests,
	TASK_SERVICE_FIXTURE,
	taskRecordsMcp,
} from "./agents.js";

const RUN_TESTS = /\bbun test\b/;
const GET_TASK = /get_task/;
const TASK_INDEX = /task_index/;
const SEARCH_TASKS = /search_tasks/;
// Any host tool that could read the workspace: file reads, search, shell, and edits.
const LOCAL_TOOLS = /^(Read|Shell|Bash|Grep|Glob|Edit|Write)$/;
// The default configuration uses OpenAI and copies the task-list sample project for each run.
// Each test closes its agents and removes their workspaces when it ends.
// Skill and workspace paths start from the directory that contains the configuration file.
const test = describe("Agent test examples", ({ agent, judge }) => ({
	coder: agent(),
	fileLookup: agent(),
	taskReader: agent({
		mcpServers: { taskRecords: taskRecordsMcp },
		workspace: TASK_SERVICE_FIXTURE,
	}),
	releaseWriter: agent({
		skills: releaseSkills,
		workspace: RELEASE_SKILL_FIXTURE,
	}),
	diagnosisReview: judge({
		prompt:
			"Read the supplied source and the agent's explanation. Does the explanation identify the actual cause of the failing status test?",
		schema: z.object({
			identifiesCause: z.boolean(),
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
	expect(run.output, "The response names Mina.").toContain("Mina");
	expect(run, "PROJECT.md is read.").toHaveReadPath("PROJECT.md");
});
test("starts separate tasks and replays conversation text when a task continues", {
	description:
		"Two independent tasks must use separate workspaces. Continuing the first task replays its conversation, so it can repeat a code that the separate task never received.",
	resources: ["coder"],
}, async ({ coder }) => {
	const secret = randomUUID();
	const [firstTask, separateTask] = await Promise.all([
		coder.run({
			prompt: `Remember this code: ${secret}. Reply with the code only. Do not use tools.`,
		}),
		coder.run({ prompt: "Reply with READY. Do not use tools." }),
	]);
	expect(firstTask.workspace.root, "Independent tasks use separate workspaces.").not.toBe(
		separateTask.workspace.root,
	);
	expect(firstTask.output, "The first task repeats the secret code.").toBe(secret);
	// Built-in hosts replay earlier user and assistant text; the follow-up prompt does not repeat the code.
	const recall =
		"What code did I ask you to remember? Reply with the code only, or NONE. Do not use tools.";
	const [followUp, separateFollowUp] = await Promise.all([
		firstTask.continue({ prompt: recall }),
		separateTask.continue({ prompt: recall }),
	]);
	expect(followUp.workspace.root, "The continuation reuses the first task workspace.").toBe(
		firstTask.workspace.root,
	);
	expect(followUp.output, "The continuation repeats the secret code.").toBe(secret);
	expect(separateFollowUp.output, "The separate task never received the code.").not.toContain(
		secret,
	);
	expect(firstTask.toolCalls, "The first task does not use tools.").toEqual([]);
	expect(followUp.toolCalls, "The continuation does not use tools.").toEqual([]);
});
test("diagnoses the failing status test without changing files", {
	description:
		"The agent investigates the sample status bug and runs bun test without editing. A judge decides whether the explanation identifies the swapped branches; code checks that no file changed.",
	resources: ["coder", "diagnosisReview"],
}, async ({ coder, diagnosisReview }) => {
	const run = await coder.run({
		prompt:
			"Find the cause of the failing status test. Read the source and test, run bun test, and explain the cause. Do not change files.",
	});
	expect(run, "The agent runs bun test.").toHaveExecutedCommand({ command: RUN_TESTS });
	expect(run.workspace.changedPaths, "No files change during the investigation.").toEqual([]);
	// Whether an explanation is right is a semantic question, so a judge grades it.
	const evaluation = await diagnosisReview.run({
		input: {
			task: run.prompt,
			explanation: run.output,
			source: await readFile(join(run.workspace.initial.path, "src/status.ts"), "utf8"),
		},
	});
	expect(
		evaluation.output.identifiesCause,
		"The judge finds the explanation identifies the cause.",
	).toBe(true);
});
test("fixes the status bug so visible and held-out tests pass", {
	description:
		"The agent fixes src/status.ts. The test reruns the visible tests and held-out tests the agent never saw in the final workspace copy, and requires that only src/status.ts changed.",
	resources: ["coder"],
}, async ({ coder }) => {
	const run = await coder.run({
		prompt:
			"Fix the status bug in src/status.ts. Change only that source file. Run bun test. End with TASK_STATUS_FIXED.",
	});
	expect(run.output, "The response contains TASK_STATUS_FIXED.").toContain("TASK_STATUS_FIXED");
	expect(run, "The agent runs bun test.").toHaveExecutedCommand({ command: RUN_TESTS });
	expect(run.workspace.changedPaths, "Only src/status.ts changes.").toEqual(["src/status.ts"]);
	// The test runs the checks itself: the agent's own command history is not the proof.
	const visible = await runStatusTests(run.workspace.final.path);
	expect(visible.exitCode, "The visible tests pass on the final workspace.").toBe(0);
	const hidden = await runHiddenStatusTests(run.workspace.final.path);
	expect(hidden.exitCode, "Held-out tests pass on the final workspace.").toBe(0);
});
test("gets a task date from the task service without local tools", {
	description:
		"The agent retrieves TASK-104 through the task service. Its workspace holds no task records, so the date can only come from the service. No file, search, or shell tool may run.",
	resources: ["taskReader"],
}, async ({ taskReader }) => {
	const run = await taskReader.run({
		prompt:
			"Call get_task with TASK-104. Reply with its current due date in YYYY-MM-DD format only. Do not use file or shell tools.",
	});
	expect(run.output, "The response contains 2026-09-24.").toContain("2026-09-24");
	expect(run, "get_task is called.").toHaveCalledTool(GET_TASK);
	expect(run, "No local file, search, or shell tool is called.").not.toHaveCalledTool(LOCAL_TOOLS);
});
// The skill holds the release-note format; PROJECT.md holds only the task ID.
test("reads an attached skill and follows its release note format", {
	description:
		"The release-note skill is attached from outside the fixture. The agent must read it and PROJECT.md, then combine the skill's format with the project's next task.",
	resources: ["releaseWriter"],
}, async ({ releaseWriter }) => {
	const run = await releaseWriter.run({
		prompt: "Use the release-note skill. Return only the release note.",
	});
	const skillFile = `${run.startingContext.skills[0].destination}/SKILL.md`;
	expect(
		existsSync(join(REPO_ROOT, RELEASE_SKILL_FIXTURE, skillFile)),
		"The fixture itself does not contain the skill.",
	).toBe(false);
	expect(
		run.workspace.initial.files[skillFile],
		"Attachment adds the skill to the workspace.",
	).toBeDefined();
	expect(run.output, "The response follows the skill's format.").toBe(
		"RELEASE: TASK-104 is ready.",
	);
	expect(run, "The release-note SKILL.md is read.").toHaveReadPath(skillFile);
	expect(run, "PROJECT.md is read.").toHaveReadPath("PROJECT.md");
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
	expect(searchOnly.output, "Search alone returns the stale date 2026-09-20.").toContain(
		"2026-09-20",
	);
	expect(searchOnly.output, "Search alone does not return the current date.").not.toContain(
		"2026-09-24",
	);
	expect(searchOnly, "The search-only task calls search_tasks.").toHaveCalledTool(SEARCH_TASKS);
	expect(searchOnly, "The search-only task does not call get_task.").not.toHaveCalledTool(GET_TASK);
	expect(detailsOnly, "The details-only task calls get_task.").toHaveCalledTool(GET_TASK);
	expect(detailsOnly, "The details-only task does not call search_tasks.").not.toHaveCalledTool(
		SEARCH_TASKS,
	);
	expect(
		searchThenDetails.output,
		"Search followed by details returns the current date.",
	).toContain("2026-09-24");
	expect(detailsOnly.output, "Task details return the current date.").toContain("2026-09-24");
	expect(
		detailsOnly.toolCalls.length,
		"The details-only task uses fewer tool calls than search followed by details.",
	).toBeLessThan(searchThenDetails.toolCalls.length);
	expect(searchThenDetails, "search_tasks runs before get_task.").toHaveCalledToolsInOrder([
		SEARCH_TASKS,
		GET_TASK,
	]);
});
// Both sources contain the current dates. This example compares two required methods.
// Reading four separate records adds work on purpose so we can compare it with one index lookup.
test("uses fewer tokens and tool calls for one index lookup than four file reads", {
	description:
		"Across two rounds, compare four separate file reads with one task-index lookup. Every answer must contain the current date; assertions compare average token use and tool calls. Two rounds are illustrative, not statistical proof.",
	resources: ["fileLookup", "taskReader"],
}, async ({ fileLookup, taskReader }) => {
	const samples = [];
	// Two rounds show how to calculate an average. They do not prove that the index always uses fewer tokens.
	for (let repetition = 0; repetition < 2; repetition++) {
		const [fileRun, indexRun] = await Promise.all([
			fileLookup.run({
				prompt:
					"Read records/TASK-101.md through records/TASK-104.md separately. Return the current due date for TASK-104 in YYYY-MM-DD format only.",
			}),
			taskReader.run({
				prompt:
					"Call task_index once to find TASK-104. Return its current due date in YYYY-MM-DD format only. Do not use other tools.",
			}),
		]);
		for (const id of ["TASK-101", "TASK-102", "TASK-103", "TASK-104"])
			expect(fileRun, "Each task record is read.").toHaveReadPath(`records/${id}.md`);
		expect(fileRun.output, "The file-based answer gives the current date.").toContain("2026-09-24");
		expect(indexRun, "The index task calls task_index.").toHaveCalledTool(TASK_INDEX);
		expect(indexRun.toolCalls, "The index task makes exactly one tool call.").toHaveLength(1);
		expect(indexRun.output, "The index-based answer gives the current date.").toContain(
			"2026-09-24",
		);
		samples.push({ fileRun, indexRun });
	}
	const fileTokens = statistics(samples.map(({ fileRun }) => fileRun.usage.tokens.total));
	const indexTokens = statistics(samples.map(({ indexRun }) => indexRun.usage.tokens.total));
	expect(indexTokens.mean, "The index lookup uses fewer tokens on average.").toBeLessThan(
		fileTokens.mean,
	);
	const fileCalls = statistics(samples.map(({ fileRun }) => fileRun.toolCalls.length));
	const indexCalls = statistics(samples.map(({ indexRun }) => indexRun.toolCalls.length));
	expect(indexCalls.mean, "The index lookup uses fewer tool calls on average.").toBeLessThan(
		fileCalls.mean,
	);
});
