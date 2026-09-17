import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { customAgent } from "../../../harness/dist/index.js";
import { describe, expect, statistics, z } from "../../dist/index.js";
import { TestRuntime } from "../../dist/sdk/runtime.js";

const fake = (options = {}) =>
	customAgent({ adapter: new URL("./fake-agent.mjs", import.meta.url).href, options });
const schema = z.object({ correct: z.boolean(), reason: z.string(), input: z.unknown() });
const test = describe("configured resources", ({ agent, judge }) => ({
	agent: agent(),
	candidate: agent({ agent: fake({ tokens: 9 }) }),
	accuracy: judge({ prompt: "Check selected evidence", schema }),
	invalid: judge({ agent: fake({ response: { correct: "wrong type" } }), prompt: "Check", schema }),
	missing: agent({ agent: fake({ omitUsage: true }) }),
}));
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
test("parallel named runs and selected-input judging", async ({ agent, candidate, accuracy }) => {
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
test("schema validation rejects malformed evaluations", async ({ invalid }) => {
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
test("setup completes before a task starts", async ({ agent }) => {
	const run = await agent.run({
		prompt: "answer",
		setup: async (workspace) => {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(join(workspace.path, "setup.txt"), "seeded");
		},
	});
	expect(run.workspace.initial.files["setup.txt"]).toBeDefined();
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
	const waiting = run.continue({ prompt: "WAIT_FOREVER" });
	// The owning test cancels this pending continuation during teardown.
	void waiting.catch(() => undefined);
	await expect(run.continue({ prompt: "answer" })).rejects.toThrow("Overlapping");
});
let previous: string | undefined;
test("records the first test workspace", async ({ agent }) => {
	previous = (await agent.run({ prompt: "answer" })).workspace.root;
});
test("test resources have fresh ownership", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output).toContain("turn 1");
	if (previous) await expect(access(previous)).rejects.toThrow();
});

const invalidJsonTest = describe("evaluation failures", ({ judge }) => ({
	malformed: judge({ agent: fake({ invalidJson: true }), prompt: "Check", schema }),
}));
invalidJsonTest("invalid JSON is an evaluation error", async ({ malformed }) => {
	await expect(malformed.run({ input: "answer" })).rejects.toThrow();
});

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

test("failed setup still cleans the task workspace", async (_resources, info) => {
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
			runtime.agent("failing", {}).run({
				prompt: "answer",
				setup: async (workspace) => {
					workspacePath = workspace.path;
					throw new Error("Setup failure");
				},
			}),
		).rejects.toThrow("Setup failure");
	} finally {
		await runtime.close();
	}
	expect(workspacePath).not.toBe("");
	await expect(access(workspacePath)).rejects.toThrow();
});
