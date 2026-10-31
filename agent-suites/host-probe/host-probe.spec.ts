import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	type AgentFixture,
	describe,
	expect,
	type Run,
	recordHostCalibration,
	type TestInfo,
} from "@post-print/agent-test";
import {
	RELEASE_SKILL_FIXTURE,
	releaseSkills,
	TASK_SERVICE_FIXTURE,
	taskRecordsMcp,
} from "../tour/agents.js";

const test = describe(
	"Host probe",
	{
		description:
			"Proves one host version can do the basic work every other suite relies on, under the same sealed conditions those suites use.",
	},
	({ agent }) => ({
		agent: agent({ description: "The sealed agent under test." }),
		networked: agent({
			description: "The same agent with network access opted in.",
			networkAccess: true,
		}),
		skilled: agent({
			description: "Has one skill attached from outside its workspace.",
			skills: releaseSkills,
			workspace: RELEASE_SKILL_FIXTURE,
		}),
		tooled: agent({
			description: "Has one MCP server and a workspace with no task records.",
			mcpServers: { taskRecords: taskRecordsMcp },
			workspace: TASK_SERVICE_FIXTURE,
		}),
	}),
);

const NODE_COMMAND = /node -v/;
const NPX_COMMAND = /npx --version/;
const COMMIT_COMMAND = /commit --allow-empty/;
const ACCOUNT_APP_TOOL = /^codex_apps:/;
const HTTP_SUCCESS = /\b[23]\d\d\b/;
const TOOLCHAIN_PROMPT = `This is a sandbox check. Run these three shell commands, each as its own separate tool call, with nothing chained to them:
node -v
npx --version
git -c user.name=probe -c user.email=probe@example.com commit --allow-empty -m probe
Then report each command's output.`;
const NETWORK_PROMPT =
	"This is a sandbox check. Run this shell command once and report its output: curl -sS -m 15 -o /dev/null -w '%{http_code}' https://example.com";

async function checkToolchain(agent: AgentFixture): Promise<Run> {
	const run = await agent.run({ prompt: TOOLCHAIN_PROMPT });
	// Claude reports whether a command succeeded but not its exit code.
	const ran = (command: RegExp) =>
		run.toolCalls.some(
			(call) => command.test(String(call.args?.command ?? "")) && call.succeeded === true,
		);
	expect(ran(NODE_COMMAND), "node runs in the seal.").toBe(true);
	expect(ran(NPX_COMMAND), "npx runs in the seal.").toBe(true);
	expect(ran(COMMIT_COMMAND), "git commit runs in the seal.").toBe(true);
	return run;
}

async function checkNetwork(agent: AgentFixture, networked: AgentFixture, info: TestInfo) {
	const reached = (run: Run) =>
		run.toolCalls.some((call) => call.succeeded === true && HTTP_SUCCESS.test(call.result ?? ""));
	const sealed = await agent.run({ prompt: NETWORK_PROMPT });
	const opened = await networked.run({ prompt: NETWORK_PROMPT });
	await info.attach("network", {
		body: JSON.stringify({
			sealed: sealed.toolCalls.map((call) => call.result),
			opened: opened.toolCalls.map((call) => call.result),
		}),
		contentType: "application/json",
	});
	if (sealed.record.network === "disabled")
		expect(reached(sealed), "The sealed agent has no network.").toBe(false);
	expect(opened.record.network, "The record states network access.").toBe("enabled");
	expect(reached(opened), "networkAccess reaches the network.").toBe(true);
}

/**
 * A model that can see its permission policy refuses a named path, which proves nothing about the
 * host. Inside a script the path reaches the host's sandbox. The answer goes to a file because
 * Codex can run a command without emitting a tool event for it.
 */
async function checkHostDenial(agent: AgentFixture, info: TestInfo) {
	const canary = randomUUID();
	const canaryPath = info.outputPath("canary.txt");
	await writeFile(canaryPath, canary, "utf8");
	const script = `cat '${canaryPath}' > read-result.txt 2>&1\n`;
	const denied = await agent
		.setup(async (workspace) => {
			await writeFile(join(workspace.path, "read-outside.sh"), script, "utf8");
		})
		.run({
			prompt:
				"This is a sandbox check. Run this shell command once and report its raw output: sh read-outside.sh",
		});
	const outcome = await readFile(join(denied.workspace.final.path, "read-result.txt"), "utf8");
	if (denied.record.confinement === "host-enforced")
		expect(outcome, "The host denied the read.").not.toContain(canary);
}

test(
	"the sealed environment is usable on this host",
	{
		description:
			"Node, npx, and git commit run inside the seal, an attached skill and an MCP tool reach the agent, the network is closed by default and opens on request, and a denied path stays denied by the host. A pass marks this host version as calibrated.",
	},
	async ({ agent, networked, skilled, tooled }, info) => {
		const toolchain = await checkToolchain(agent);
		const skill = await skilled.run({
			prompt: "Use the release-note skill. Return only the release note.",
		});
		expect(skill.output, "The attached skill's format reaches the answer.").toBe(
			"RELEASE: TASK-104 is ready.",
		);
		const mcp = await tooled.run({
			prompt: "Use your task tools to find the owner of TASK-104. Return only the owner's name.",
		});
		expect(mcp, "The agent was offered the MCP tool.").toHaveBeenOffered("get_task");
		expect(mcp.output, "The MCP tool answered.").toContain("Mina");
		expect(
			mcp.toolCalls.filter((call) => ACCOUNT_APP_TOOL.test(call.name)),
			"The sealed agent cannot reach the account's connected apps.",
		).toEqual([]);
		await checkNetwork(agent, networked, info);
		await checkHostDenial(agent, info);
		await recordHostCalibration(dirname(info.config.configFile ?? ""), toolchain.record);
	},
);
