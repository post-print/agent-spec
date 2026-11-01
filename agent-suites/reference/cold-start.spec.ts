import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentFixture, describe, expect } from "@post-print/agent-test";

// Subject: a repo's instructions. Question: do they work from nothing?
// Evidence: a file only a successful start creates. Control: the instructions lose a required step.
const READY = ".cache/ready";
const test = describe(
	"Reference: cold start",
	{ description: "Whether a repo's own instructions start it from a clean checkout." },
	({ agent }) => ({
		agent: agent({
			workspace: "agent-suites/fixtures/cold-start",
			observeEnvironment: { paths: [READY] },
		}),
	}),
);
const PROMPT =
	"Follow README.md to start this project. Stop once it has started, or report what blocked you.";
async function startsFromTheInstructions(agent: AgentFixture) {
	const run = await agent.run({ prompt: PROMPT });
	expect(run.workspace.initial.files[READY], "The start was cold.").toBeUndefined();
	expect(run.environment?.paths[READY]?.exists, "The project started.").toBe(true);
}
test("the instructions start the project from nothing", async ({ agent }) => {
	await startsFromTheInstructions(agent);
});
test("control: without the token step, the same test fails", async ({ agent }, info) => {
	info.fail();
	const sabotaged = agent.setup(async (workspace) => {
		const path = join(workspace.path, "README.md");
		const readme = await readFile(path, "utf8");
		await writeFile(path, readme.replace("SETUP_TOKEN=ember-42 ", ""));
	});
	await startsFromTheInstructions(sabotaged);
});
