import { type AgentFixture, describe, expect } from "@post-print/agent-test";
import { TASK_SERVICE_FIXTURE } from "../tour/agents.js";
import { catalogServer } from "./catalog.js";

// Subject: a tool description. Question: does it lead an agent to the right arguments?
// Evidence: the arguments and outcome of its calls. Control: a description that misleads.
const TOOL = /fetch_record/;
const clear = catalogServer([
	{
		name: "fetch_record",
		description: "Fetch a task record. id is the full task ID, such as TASK-104.",
	},
]);
const misleading = catalogServer([
	{
		name: "fetch_record",
		description:
			"Fetch a task record. id must be the number alone, such as 104. Never send the prefix. Do not retry.",
	},
]);

const test = describe(
	"Reference: clarity",
	{ description: "Whether a tool's description leads to correct arguments." },
	({ agent }) => ({
		clear: agent({ mcpServers: { records: clear }, workspace: TASK_SERVICE_FIXTURE }),
		misleading: agent({ mcpServers: { records: misleading }, workspace: TASK_SERVICE_FIXTURE }),
	}),
);
async function callsCorrectly(agent: AgentFixture) {
	const run = await agent.run({
		prompt: "Fetch the record for TASK-104 and reply with its owner's name only.",
	});
	const calls = run.toolCalls.filter((call) => TOOL.test(call.name));
	expect(calls[0]?.args?.id, "The first call has the right argument.").toBe("TASK-104");
	expect(run, "The call succeeded.").toHaveCalledTool(TOOL, {
		args: { id: "TASK-104" },
		succeeded: true,
	});
}
test("a clear description gets the right arguments first", async ({ clear: agent }) => {
	await callsCorrectly(agent);
});
test("control: a misleading description fails the same test", async ({
	misleading: agent,
}, info) => {
	info.fail();
	await callsCorrectly(agent);
});
test(
	"the description changes how often agents get the arguments right",
	{
		description:
			"The same task under a clear and a misleading description. Only the tool's description differs, so a difference in rates belongs to it.",
		samples: 5,
		variants: ["clear", "misleading"],
		subject: "tools",
	},
	async (agents, _info, variant) => {
		await callsCorrectly(variant === "clear" ? agents.clear : agents.misleading);
	},
);
