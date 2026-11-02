import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { customAgent, openai } from "../../../harness/dist/index.js";
import {
	describe,
	expect,
	expectWorkspaceEscape,
	statistics,
	WorkspaceEscapeError,
	z,
} from "../../dist/index.js";
import { TestRuntime } from "../../dist/sdk/runtime.js";

const fake = (options = {}) =>
	customAgent({ adapter: new URL("./fake-agent.mjs", import.meta.url).href, options });
const schema = z.object({ correct: z.boolean(), reason: z.string(), input: z.unknown() });
const test = describe("configured resources", ({ agent, judge }) => ({
	agent: agent({ description: "Uses the suite's default agent configuration." }),
	seeded: agent().setup(async (workspace) => {
		await writeFile(join(workspace.path, "seed.txt"), "first");
	}),
	candidate: agent({
		description: "A lower-token candidate used for the comparison.",
		agent: fake({ tokens: 9 }),
	}),
	accuracy: judge({ prompt: "Check selected evidence", schema }),
	invalid: judge({ agent: fake({ response: { correct: "wrong type" } }), prompt: "Check", schema }),
	missing: agent({ agent: fake({ omitUsage: true }) }),
	narrating: agent({ agent: fake({ progress: "I am checking the project." }) }),
}));

test("run output is the final assistant response while the transcript keeps progress", async ({
	narrating,
}) => {
	const run = await narrating.run({ prompt: "answer" });
	expect(run.output).toBe("Mina turn 1");
	const transcript = run.trace.messages.map((message) => message.content);
	expect(transcript).toContain("I am checking the project.");
	expect(transcript).toContain("Mina turn 1");
});
test("independent runs, continuation, and evidence", async ({ agent }) => {
	const [first, independent] = await Promise.all([
		agent.run({ prompt: "edit" }),
		agent.run({ prompt: "answer" }),
	]);
	expect(first.output).toContain("turn 1");
	expect(independent.output).toContain("turn 1");
	expect(first.workspace.root).not.toBe(independent.workspace.root);
	expect(independent.workspace.final.files["result.txt"]).toBeUndefined();
	const next = await first.continue({ prompt: "answer again" });
	expect(next.output).toContain("turn 2");
	expect(next.workspace.root).toBe(first.workspace.root);
	expect(first).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
	expect(first).toHaveReadPath("PROJECT.md");
	expect(first).toHaveModifiedPath("result.txt");
});
test("parallel named runs and selected-input judging", {
	description:
		"Run two agents in parallel, compare their token usage, and ask the accuracy judge to evaluate only the two selected answers.",
	resources: ["agent", "candidate", "accuracy"],
	criteria: [
		"Both named agents complete independently.",
		"The candidate uses fewer tokens than the baseline.",
		"The accuracy judge accepts both selected answers.",
	],
}, async ({ agent, candidate, accuracy }) => {
	const [baseline, improved] = await Promise.all([
		agent.run({ prompt: "answer" }),
		candidate.run({ prompt: "answer" }),
	]);
	expect(statistics([improved.usage.tokens.total]).mean).toBeLessThan(
		statistics([baseline.usage.tokens.total]).mean,
	);
	const grade = await accuracy.run({
		input: { baseline: baseline.output, candidate: improved.output },
	});
	expect(grade.output.correct).toBe(true);
	const request = JSON.parse(await readFile(join(grade.artifact, "request.json"), "utf8"));
	expect(request.input).toEqual({ baseline: baseline.output, candidate: improved.output });
	expect(request.prompt).not.toContain("PROJECT.md");
	expect(request.prompt).not.toContain(baseline.workspace.root);
	expect(request.prompt).not.toContain("toolCalls");
});
test("schema validation rejects malformed evaluations", {
	description: "Only the rejection is under test.",
	noAgent: true,
}, async ({ invalid }) => {
	await expect(invalid.run({ input: "answer" })).rejects.toThrow();
});
test("multiple evaluations remain independent", async ({ accuracy }) => {
	const [one, two] = await Promise.all([
		accuracy.run({ input: "one" }),
		accuracy.run({ input: "two" }),
	]);
	expect(one.output.input).toBe("one");
	expect(two.output.input).toBe("two");
	expect(one.artifact).not.toBe(two.artifact);
});
test("missing tokens never become a zero or partial average", async ({ missing }) => {
	const run = await missing.run({ prompt: "answer" });
	expect(run.usage.tokens.total).toBeUndefined();
	expect(() => statistics([10, run.usage.tokens.total]).mean).toThrow("Metric unavailable");
});
test("run resources are isolated from subsequent calls", async ({ agent }) => {
	const selected = await agent.run({
		prompt: "answer",
		skills: ["./skills/review"],
		context: { instructions: ["ONLY_THIS_RUN"], files: ["./context.md"] },
	});
	const plain = await agent.run({ prompt: "answer" });
	expect(selected.startingContext.files[0].content).toContain("CONTEXT_SENTINEL");
	expect(selected.workspace.initial.files[".agents/skills/review/SKILL.md"]).toBeDefined();
	expect(plain.startingContext.skills).toEqual([]);
	expect(plain.trace.messages[0].content).not.toContain("ONLY_THIS_RUN");
	expect(plain.workspace.initial.files[".agents/skills/review/SKILL.md"]).toBeUndefined();
});
test("setup chains are immutable and run once per independent workspace", async ({
	agent,
	seeded,
}) => {
	let preparations = 0;
	const prepared = seeded.setup(async (workspace) => {
		preparations++;
		expect(await readFile(join(workspace.path, "seed.txt"), "utf8")).toBe("first");
		await writeFile(join(workspace.path, "second.txt"), "second");
	});
	const first = await prepared.run({ prompt: "answer" });
	const second = await prepared.run({ prompt: "answer" });
	expect(preparations).toBe(2);
	expect(first.workspace.initial.files["second.txt"]).toBeDefined();
	expect(second.workspace.root).not.toBe(first.workspace.root);
	await first.continue({ prompt: "continue" });
	expect(preparations).toBe(2);
	const base = await seeded.run({ prompt: "answer" });
	expect(base.workspace.initial.files["seed.txt"]).toBeDefined();
	expect(base.workspace.initial.files["second.txt"]).toBeUndefined();
	const plain = await agent.run({ prompt: "answer" });
	expect(plain.workspace.initial.files["seed.txt"]).toBeUndefined();
});
test("matchers require exact paths and proven exit codes", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run).not.toHaveAccessedPath("NOT-PROJECT.md");
	const command = run.toolCalls.find((call) => call.args?.command === "npm test");
	if (!command) throw new Error("Missing command");
	const missing = { ...run, toolCalls: [{ ...command, exitCode: undefined }] };
	expect(() =>
		expect(missing).not.toHaveExecutedCommand({ command: "npm test", exitCode: 0 }),
	).toThrow("unavailable");
});
test("test teardown cancels pending siblings and cleans completed workspaces", async ({
	agent,
}, info) => {
	const run = await agent.run({ prompt: "answer" });
	const runtime = new TestRuntime({
		baseDir: new URL(".", import.meta.url).pathname,
		outputDir: info.outputPath("cancel"),
		agent: fake(),
		workspace: "./project",
		signal: new AbortController().signal,
	});
	const task = runtime.agent("pending", {});
	const finished = await task.run({ prompt: "answer" });
	const waiting = task.run({ prompt: "WAIT_FOREVER" });
	const rejected = expect(waiting).rejects.toThrow();
	await runtime.close();
	await rejected;
	await expect(access(finished.workspace.root)).rejects.toThrow();
	expect(run.output).toContain("Mina");
	await expect(task.run({ prompt: "answer" })).rejects.toThrow("closed");
});
test("continuation rejects overlapping conversation turns", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output).toContain("turn 1");
	const waiting = run.continue({ prompt: "WAIT_FOREVER" });
	// The owning test cancels this pending continuation during teardown.
	void waiting.catch(() => undefined);
	await expect(run.continue({ prompt: "answer" })).rejects.toThrow("Overlapping");
});
let previous: string | undefined;
test("records the first test workspace", async ({ agent }) => {
	previous = (await agent.run({ prompt: "answer" })).workspace.root;
	expect(previous, "The run has its own workspace.").toBeTruthy();
});
test("test resources have fresh ownership", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output).toContain("turn 1");
	if (previous) await expect(access(previous)).rejects.toThrow();
});

const invalidJsonTest = describe("evaluation failures", ({ judge }) => ({
	malformed: judge({ agent: fake({ invalidJson: true }), prompt: "Check", schema }),
}));
invalidJsonTest(
	"invalid JSON is an evaluation error",
	{ description: "Only the rejection is under test.", noAgent: true },
	async ({ malformed }) => {
		await expect(malformed.run({ input: "answer" })).rejects.toThrow();
	},
);

test("missing reviewer does not borrow the coding agent", async ({ agent }, info) => {
	const runtime = new TestRuntime({
		baseDir: new URL(".", import.meta.url).pathname,
		outputDir: info.outputPath("no-reviewer"),
		agent: fake(),
		workspace: "./project",
		signal: new AbortController().signal,
	});
	try {
		await expect(
			runtime.judge("missing", { prompt: "Check", schema }).run({ input: "answer" }),
		).rejects.toThrow("Configure an agent");
		expect((await agent.run({ prompt: "answer" })).output).toContain("Mina");
	} finally {
		await runtime.close();
	}
});

test(
	"failed setup still cleans the task workspace",
	{ description: "The operation runs on its own runtime.", noAgent: true },
	async (_resources, info) => {
		const runtime = new TestRuntime({
			baseDir: new URL(".", import.meta.url).pathname,
			outputDir: info.outputPath("failed-setup"),
			agent: fake(),
			workspace: "./project",
			signal: new AbortController().signal,
		});
		let workspacePath = "";
		try {
			await expect(
				runtime
					.agent("failing", {})
					.setup(async (workspace) => {
						workspacePath = workspace.path;
						throw new Error("Setup failure");
					})
					.run({ prompt: "answer" }),
			).rejects.toThrow("Setup failure");
		} finally {
			await runtime.close();
		}
		expect(workspacePath).not.toBe("");
		await expect(access(workspacePath)).rejects.toThrow();
	},
);
test("a run that names a path outside its workspace is rejected", async ({ agent }) => {
	const { escaped } = await expectWorkspaceEscape(agent.run({ prompt: "ESCAPE" }));
	expect(escaped).toBeInstanceOf(WorkspaceEscapeError);
	expect(escaped?.paths).toEqual(["../owner.json"]);
});

const earned = { description: "The operations run on their own runtime.", noAgent: true };
function ownRuntime(outputDir: string) {
	return new TestRuntime({
		baseDir: new URL(".", import.meta.url).pathname,
		outputDir,
		agent: fake(),
		workspace: "./project",
		signal: new AbortController().signal,
	});
}
const NOT_EARNED = { noAgent: false };
test("a test with no completed operation has not earned a result", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("no-operation"));
	try {
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow("without a completed agent");
		expect(() => runtime.assertResultEarned({ noAgent: true })).not.toThrow();
		const failed = runtime.agent("failed", {}).run({ prompt: "FAIL_NOW" });
		await expect(failed).rejects.toThrow("fake failure");
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow("without a completed agent");
		const complete = await runtime.agent("complete", {}).run({ prompt: "answer" });
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow("without a check");
		expect(complete.output).toContain("turn 1");
		expect(() => runtime.assertResultEarned(NOT_EARNED)).not.toThrow();
	} finally {
		await runtime.close();
	}
});
test("an unawaited failure fails the test even after later work", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("floating"));
	try {
		void runtime.agent("floating", {}).run({ prompt: "FAIL_NOW" });
		await runtime.agent("complete", {}).run({ prompt: "answer" });
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow("not awaited");
	} finally {
		await runtime.close();
	}
});
test("an unawaited run still in progress fails the test", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("pending"));
	try {
		void runtime.agent("pending", {}).run({ prompt: "WAIT_FOREVER" });
		await runtime.agent("complete", {}).run({ prompt: "answer" });
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow("not awaited");
	} finally {
		await runtime.close();
	}
});
test("a failure observed later is the test's to handle", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("late"));
	try {
		const failing = runtime.agent("failing", {}).run({ prompt: "FAIL_NOW" });
		expect((await runtime.agent("complete", {}).run({ prompt: "answer" })).output).toBeTruthy();
		await expect(failing).rejects.toThrow("fake failure");
		expect(() => runtime.assertResultEarned(NOT_EARNED)).not.toThrow();
	} finally {
		await runtime.close();
	}
});
test("catching a workspace escape does not erase it", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("caught-escape"));
	try {
		await runtime
			.agent("escaping", {})
			.run({ prompt: "ESCAPE" })
			.catch(() => undefined);
		await runtime.agent("complete", {}).run({ prompt: "answer" });
		expect(() => runtime.assertResultEarned(NOT_EARNED)).toThrow(WorkspaceEscapeError);
	} finally {
		await runtime.close();
	}
});
test("an expected escape counts as the agent acting", earned, async (_r, info) => {
	const runtime = ownRuntime(info.outputPath("expected-escape"));
	try {
		await expectWorkspaceEscape(runtime.agent("escaping", {}).run({ prompt: "ESCAPE" }));
		expect(() => runtime.assertResultEarned(NOT_EARNED)).not.toThrow();
	} finally {
		await runtime.close();
	}
});
test("expecting an escape rejects a run that made no attempt", async ({ agent }) => {
	await expect(expectWorkspaceEscape(agent.run({ prompt: "answer" }))).rejects.toThrow(
		"but it completed",
	);
	const { escaped, run } = await expectWorkspaceEscape(agent.run({ prompt: "answer" }), {
		allowRefusal: true,
	});
	expect(escaped).toBeUndefined();
	expect(run?.output).toContain("Mina");
});
test("a stalled host hits its deadline before the test runner does", earned, async (_r, info) => {
	const runtime = new TestRuntime({
		baseDir: new URL(".", import.meta.url).pathname,
		outputDir: info.outputPath("deadline"),
		agent: openai({ timeoutMs: 600_000 }),
		workspace: "./project",
		signal: new AbortController().signal,
		remainingTestMs: () => 1_500,
	});
	const previousBin = process.env.CODEX_BIN;
	process.env.CODEX_BIN = new URL("./fake-codex-stall.mjs", import.meta.url).pathname;
	try {
		await expect(runtime.agent("stalled", {}).run({ prompt: "answer" })).rejects.toMatchObject({
			kind: "infrastructure",
			code: "timeout",
			timeoutMs: 1_000,
		});
	} finally {
		if (previousBin === undefined) delete process.env.CODEX_BIN;
		else process.env.CODEX_BIN = previousBin;
		await runtime.close();
	}
});
