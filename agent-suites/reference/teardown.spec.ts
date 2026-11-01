import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AgentFixture, describe, expect } from "@post-print/agent-test";

// Subject: a repo's stop instructions. Question: do they leave nothing behind?
// Evidence: processes still alive after the run. Control: the stop script does nothing.
const test = describe(
	"Reference: teardown",
	{ description: "Whether a repo's own instructions stop what they started." },
	({ agent }) => ({
		agent: agent({
			workspace: "agent-suites/fixtures/teardown",
			observeEnvironment: {},
		}),
	}),
);
const PROMPT =
	"Follow README.md exactly: start the dev server, then stop it with the command it gives. Run only those two commands, then say done.";
async function leavesNothingBehind(agent: AgentFixture) {
	const run = await agent.run({ prompt: PROMPT });
	expect(run.environment?.processesKnown, "Processes could be observed.").toBe(true);
	expect(run.workspace.final.files["dev.started"], "The server did start.").toBeDefined();
	expect(run.environment?.processes, "No process is left behind.").toEqual([]);
}
test("the instructions stop what they started", async ({ agent }) => {
	await leavesNothingBehind(agent);
});
test("control: with a stop script that does nothing, the same test fails", async ({
	agent,
}, info) => {
	info.fail();
	const sabotaged = agent.setup(async (workspace) => {
		await writeFile(join(workspace.path, "stop.mjs"), 'console.log("Stopped.");\n');
	});
	await leavesNothingBehind(sabotaged);
});
