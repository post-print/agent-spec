import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { customAgent } from "../../../harness/dist/index.js";
import { defineJudge, expect, test } from "../../dist/index.js";

const fake = (options = {}) =>
	customAgent({ adapter: new URL("./fake-agent.mjs", import.meta.url).href, options });
test.use({ agent: fake() });
const judge = defineJudge({
	agent: fake(),
	criteria: {
		correctness: {
			description: "Answers from PROJECT.md",
			scores: { 0: "Incorrect", 1: "Correct" },
		},
	},
});
test("configured agent, continuation, evidence and grading", async ({ agent, workspace }) => {
	const run = await agent.run("edit then answer");
	expect(run.output).toContain("Mina turn 1");
	expect(run).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
	expect(run).toHaveReadPath("PROJECT.md");
	expect(run).toHaveModifiedPath("result.txt");
	expect(await workspace.readFile("result.txt")).toBe("done");
	const next = await agent.run("answer again");
	expect(next.output).toContain("turn 2");
	const grade = await run.judge(judge);
	expect(grade.scores.correctness).toBe(1);
});
test("variants, repetitions, tokens, and independently graded runs", async ({ compare }) => {
	const result = await compare({
		prompt: "answer",
		variants: {
			baseline: { agent: fake({ tokens: 30 }), repeat: 2 },
			candidate: { agent: fake(), repeat: 2 },
		},
	});
	expect(result.runs).toHaveLength(4);
	expect(result.variants.candidate.metrics.tokens.total.mean).toBe(15);
	expect(result.variants.candidate.metrics.tokens.total.mean).toBeLessThan(
		result.variants.baseline.metrics.tokens.total.mean,
	);
	for (const run of result.runs) expect(run.output).toContain("turn 1");
	const grade = await result.judge(judge);
	expect(grade.variants.candidate.runs).toHaveLength(2);
	expect(grade.winner).toBeNull();
});
test("expected failed control", async ({ compare }) => {
	const result = await compare({
		prompt: "answer",
		variants: {
			control: { agent: fake({ answer: "wrong" }), expectedFailures: ["owner"] },
			candidate: { agent: fake() },
		},
		checks: async (run, check) => {
			await check("owner", () => expect(run.output).toContain("Mina"));
		},
	});
	expect(result.runs).toHaveLength(2);
});
test("missing token data never becomes zero", async ({ compare }) => {
	const result = await compare({
		prompt: "answer",
		variants: { candidate: { agent: fake({ omitUsage: true }) } },
	});
	expect(result.variants.candidate.metrics.tokens.total.available).toBe(false);
	expect(() => result.variants.candidate.metrics.tokens.total.mean).toThrow("Metric unavailable");
});

test("attaches context and skills before a test uses the definition", async ({ compare }) => {
	const configured = customAgent({
		adapter: new URL("./fake-agent.mjs", import.meta.url).href,
		options: {
			skills: ["./skills/review"],
			context: { instructions: ["Instruction sentinel"], files: ["./context.md"] },
			includeGlobalSkills: false,
		},
	});
	const result = await compare({
		prompt: "answer",
		variants: { configured: { agent: configured } },
	});
	const run = result.runs[0];
	expect(run.startingContext.instructions).toEqual(["Instruction sentinel"]);
	expect(run.startingContext.files[0].content).toContain("CONTEXT_SENTINEL");
	expect(run.workspace.initial.files[".agents/skills/review/SKILL.md"]).toBeDefined();
	expect(run.trace.messages[0].content).toContain("Instruction sentinel");
});

test("cancellation terminates the worker while a run is pending", async ({ workspace }) => {
	const { createAgentSession } = await import("../../../harness/dist/index.js");
	const controller = new AbortController();
	const session = await createAgentSession({
		agent: fake(),
		workspace: workspace.path,
		signal: controller.signal,
	});
	const result = session.run("WAIT_FOREVER");
	setTimeout(() => controller.abort(), 30);
	await expect(result).rejects.toThrow("cancelled");
	await session.close();
});

test("unexpected successful control fails the comparison", async ({ compare }) => {
	await expect(
		compare({
			prompt: "answer",
			variants: { control: { agent: fake(), expectedFailures: ["owner"] } },
			checks: async (run, check) => {
				await check("owner", () => expect(run.output).toContain("Mina"));
			},
		}),
	).rejects.toThrow("unexpectedly passed");
});

test("arbitrary errors cannot be hidden as expected behavioral failures", async ({ compare }) => {
	await expect(
		compare({
			prompt: "answer",
			variants: { control: { agent: fake(), expectedFailures: ["owner"] } },
			checks: async (_run, check) => {
				await check("owner", () => {
					throw new Error("infrastructure unavailable");
				});
			},
		}),
	).rejects.toThrow("infrastructure unavailable");
});

const extendedTest = test.extend<{ greeting: string }>({ greeting: "Hello" });
extendedTest.use({ agent: fake() });
extendedTest("extended fixtures preserve the configured agent API", async ({ agent, greeting }) => {
	expect(greeting).toBe("Hello");
	expect((await agent.run("answer")).output).toContain("Mina");
});

test("matchers require exact paths and retain proven evidence", async ({ agent }) => {
	const run = await agent.run("answer");
	expect(run).toHaveReadPath("PROJECT.md");
	expect(run).not.toHaveAccessedPath("NOT-PROJECT.md");
	const command =
		run.toolCalls.find((call) => call.name === "shell") ??
		run.toolCalls.find((call) => call.args?.command === "npm test");
	if (!command) throw new Error("Fake adapter omitted the expected command");
	const uncertain = { ...run, toolCalls: [...run.toolCalls, { ...command, exitCode: undefined }] };
	expect(uncertain).toHaveExecutedCommand({ command: "npm test", exitCode: 0 });
	const missing = { ...run, toolCalls: [{ ...command, exitCode: undefined }] };
	expect(() =>
		expect(missing).not.toHaveExecutedCommand({ command: "npm test", exitCode: 0 }),
	).toThrow("unavailable");
});

test("reference context stays with the judge and invalid citations fail", async ({ agent }) => {
	const run = await agent.run("answer");
	const grade = await run.judge({
		...judge,
		context: { reference: { text: "JUDGE_ONLY_SENTINEL" } },
	});
	expect(JSON.stringify(run)).not.toContain("JUDGE_ONLY_SENTINEL");
	const request = JSON.parse(await readFile(join(grade.artifact, "request.json"), "utf8"));
	expect(request.evidence.reference.text).toBe("JUDGE_ONLY_SENTINEL");
	expect(request.evidence.metrics).toBeUndefined();
	await expect(run.judge({ ...judge, agent: fake({ evidenceLine: 99999 }) })).rejects.toThrow(
		"unknown file line",
	);
});
