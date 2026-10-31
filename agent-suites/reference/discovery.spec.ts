import { type AgentFixture, describe, expect } from "@post-print/agent-test";
import { TASK_SERVICE_FIXTURE } from "../tour/agents.js";
import { catalogServer } from "./catalog.js";

// Subject: an MCP tool. Question: do agents find it when nothing names it?
// Evidence: the catalog the run recorded and the tool call. Control: the tool is not offered.
const TOOL = "task_owner";
const offered = catalogServer([
	{ name: TOOL, description: "Find who owns a task, given its task ID." },
]);
const notOffered = catalogServer([{ name: "ping", description: "Check the server is up." }]);

const test = describe(
	"Reference: discovery",
	{ description: "Whether an agent finds a tool the prompt does not name." },
	({ agent }) => ({
		withTool: agent({ mcpServers: { records: offered }, workspace: TASK_SERVICE_FIXTURE }),
		withoutTool: agent({ mcpServers: { records: notOffered }, workspace: TASK_SERVICE_FIXTURE }),
	}),
);
async function findsTheOwner(agent: AgentFixture) {
	const run = await agent.run({ prompt: "Who owns TASK-104? Reply with the owner's name only." });
	expect(run, "The agent was offered the tool.").toHaveBeenOffered(TOOL);
	expect(run.prompt, "The prompt does not name the tool.").not.toContain(TOOL);
	expect(run, "The agent called the tool.").toHaveCalledTool(new RegExp(TOOL), { succeeded: true });
	expect(run.output, "The answer comes from the tool.").toContain("Mina");
}
test("an agent finds a tool the prompt does not name", async ({ withTool }) => {
	await findsTheOwner(withTool);
});
test("control: with the tool removed, the same test fails", async ({ withoutTool }, info) => {
	info.fail();
	await findsTheOwner(withoutTool);
});
