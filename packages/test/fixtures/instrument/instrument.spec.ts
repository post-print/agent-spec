import { describe, expect, type Run } from "../../dist/index.js";

const test = describe("instrument", ({ agent }) => ({
	agent: agent({ description: "A scripted host." }),
}));
const scenario = (name: string) => ({ prompt: `SCENARIO_${name}` });

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
