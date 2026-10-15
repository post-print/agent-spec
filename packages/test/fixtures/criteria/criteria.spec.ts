import { describe, expect } from "../../src/index.js";

const test = describe("criteria discovery", ({ agent }) => ({ agent: agent() }));
const described = describe(
	"described suite",
	{ description: "Suite-level intent shown once." },
	({ agent }) => ({ agent: agent() }),
);

test("derives direct assertions", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output, "The response contains READY.").toContain("READY");
	expect(run, "The agent does not access secret.txt.").not.toHaveAccessedPath("secret.txt");
});

test("keeps explicit criteria", {
	description: "Explicit metadata",
	criteria: ["The declared criterion wins."],
}, async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output).toContain("IGNORED IN THE SETUP VIEW");
});

described("carries the suite description", async ({ agent }) => {
	const run = await agent.run({ prompt: "answer" });
	expect(run.output, "The response contains READY.").toContain("READY");
});
