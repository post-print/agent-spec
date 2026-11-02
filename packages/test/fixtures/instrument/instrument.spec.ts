import { describe, expect, type Run, z } from "../../dist/index.js";

const test = describe("instrument", ({ agent, judge }) => ({
	agent: agent({ description: "A scripted host." }),
	reviewer: judge({ prompt: "Is the input correct?", schema: z.object({ correct: z.boolean() }) }),
	unconvertible: judge({
		prompt: "Is the input correct?",
		schema: z.object({ correct: z.boolean() }).transform(({ correct }) => correct),
	}),
}));
const scenario = (name: string) => ({ prompt: `SCENARIO_${name}` });

test("judge verdict comes from enforced output", async ({ reviewer }) => {
	const { output } = await reviewer.run({ input: "SCENARIO_JUDGE_ENFORCED" });
	expect(output.correct).toBe(true);
});
test("judge answers with the schema", async ({ reviewer }) => {
	await reviewer.run({ input: "SCENARIO_JUDGE_ECHOES_SCHEMA" });
});
test("judge answers in prose", async ({ reviewer }) => {
	await reviewer.run({ input: "SCENARIO_JUDGE_PROSE" });
});
test("judge host reports a failure", async ({ reviewer }) => {
	await reviewer.run({ input: "SCENARIO_JUDGE_REFUSED" });
});
test("judge rejects the answer", async ({ reviewer }) => {
	const { output } = await reviewer.run({ input: "SCENARIO_JUDGE_ENFORCED" });
	expect(output.correct, "The judge accepted it.").toBe(false);
});
test("judge rejects the answer while another judge is running", async ({ reviewer }) => {
	const running = reviewer.run({ input: "SCENARIO_JUDGE_SLOW" });
	running.catch(() => undefined);
	const { output } = await reviewer.run({ input: "SCENARIO_JUDGE_ENFORCED" });
	expect(output.correct, "The judge accepted it.").toBe(false);
	await running;
});
test("judge cannot start", async ({ unconvertible }) => {
	await unconvertible.run({ input: "answer" });
});

test("good run", async ({ agent }) => {
	expect((await agent.run(scenario("GOOD"))).output).toBe("done");
});
test("assertion fails", async ({ agent }) => {
	expect((await agent.run(scenario("GOOD"))).output).toBe("something else");
});
test("host reports hitting its limit", async ({ agent }) => {
	await agent.run(scenario("MAX_TURNS"));
});
test("host emits nothing", async ({ agent }) => {
	await agent.run(scenario("EMPTY"));
});
test("host emits garbage", async ({ agent }) => {
	await agent.run(scenario("GARBAGE"));
});
test("host is killed", async ({ agent }) => {
	await agent.run(scenario("CRASH"));
});
test("host is not logged in", async ({ agent }) => {
	await agent.run(scenario("AUTH"));
});
test("negative assertion on an empty run", async ({ agent }) => {
	const run = await agent.run(scenario("EMPTY"));
	expect(run.toolCalls).toEqual([]);
});
test("test never runs an agent", async () => {
	expect(1).toBe(1);
});
test("unawaited run fails", async ({ agent }) => {
	void agent.run(scenario("AUTH"));
	await agent.run(scenario("GOOD"));
});
test("catalog is unknown", async ({ agent }) => {
	const run = await agent.run(scenario("GOOD"));
	const unknown: Run = { ...run, exposure: { source: "unknown", tools: [], mcpServers: [] } };
	expect(unknown).toHaveBeenOffered("anything");
});
test("skipped", async ({ agent }, info) => {
	info.skip(true, "Skipped on purpose.");
	await agent.run(scenario("GOOD"));
});
test("passes on retry", async ({ agent }, info) => {
	expect((await agent.run(scenario("GOOD"))).output).toBe(
		info.retry > 0 ? "done" : "first try fails",
	);
});
const rates = describe("instrument rates", ({ agent, judge }) => ({
	agent: agent({ description: "A scripted host." }),
	reviewer: judge({ prompt: "Is the input correct?", schema: z.object({ correct: z.boolean() }) }),
}));
rates("sampled pass", { description: "Five good runs.", samples: 5 }, async ({ agent }) => {
	expect((await agent.run(scenario("GOOD"))).output).toBe("done");
});
rates(
	"sampled with a failure",
	{ description: "One run in three fails, with nothing required.", samples: 3 },
	async ({ agent }, info) => {
		expect(
			info.title.includes("[2/3]") ? "wrong" : (await agent.run(scenario("GOOD"))).output,
		).toBe("done");
	},
);
rates(
	"plan flags early",
	{ description: "Every run fails, so the plan decides at two.", samples: { n: 5, flagAt: 2 } },
	async ({ agent }) => {
		expect((await agent.run(scenario("GOOD"))).output).toBe("wrong");
	},
);
rates(
	"plan clears early",
	{ description: "Passes, so the flag soon cannot be reached.", samples: { n: 5, flagAt: 2 } },
	async ({ agent }) => {
		expect((await agent.run(scenario("GOOD"))).output).toBe("done");
	},
);
rates(
	"plan short of verdicts",
	{ description: "Half the judge replies are unusable.", samples: { n: 4, flagAt: 2 } },
	async ({ reviewer }, info) => {
		const unusable = info.title.includes("[1/4]") || info.title.includes("[2/4]");
		const input = unusable ? "SCENARIO_JUDGE_PROSE" : "SCENARIO_JUDGE_ENFORCED";
		expect((await reviewer.run({ input })).output.correct).toBe(true);
	},
);
rates(
	"plan of controls",
	{ description: "Every sample fails as it must.", samples: { n: 4, flagAt: 2 } },
	async ({ agent }, info) => {
		info.fail();
		expect((await agent.run(scenario("GOOD"))).output).toBe("wrong");
	},
);
rates(
	"plan with handled judge failures",
	{
		description: "No sample earns a verdict, so none brings a stop closer.",
		samples: { n: 4, flagAt: 2 },
	},
	async ({ reviewer }) => {
		await reviewer.run({ input: "SCENARIO_JUDGE_PROSE" }).catch(() => undefined);
		expect("wrong").toBe("done");
	},
);
rates(
	"plan with soft failures",
	{ description: "A soft failure counts toward the flag.", samples: { n: 4, flagAt: 2 } },
	async ({ agent }) => {
		expect.soft((await agent.run(scenario("GOOD"))).output).toBe("wrong");
	},
);
rates("repeat short of verdicts", async ({ reviewer }, info) => {
	const input = info.repeatEachIndex === 0 ? "SCENARIO_JUDGE_PROSE" : "SCENARIO_JUDGE_ENFORCED";
	expect((await reviewer.run({ input })).output.correct).toBe(true);
});
rates(
	"infrastructure is not a sample",
	{ description: "The host fails, so no run has a verdict.", samples: 2 },
	async ({ agent }) => {
		await agent.run(scenario("EMPTY"));
	},
);
rates(
	"two arms differ",
	{
		description: "One arm passes and one fails.",
		samples: 5,
		variants: ["good", "bad"],
		subject: "prompt",
	},
	async ({ agent }, _info, variant) => {
		await agent.run(scenario("GOOD"));
		expect(variant, "This arm passes.").toBe("good");
	},
);
rates(
	"arms differ beyond the subject",
	{
		description: "The prompt differs, but the declared subject is the workspace.",
		samples: 1,
		variants: ["one", "two"],
		subject: "workspace",
	},
	async ({ agent }, _info, variant) => {
		await agent.run({ prompt: `SCENARIO_GOOD ${variant}` });
	},
);
