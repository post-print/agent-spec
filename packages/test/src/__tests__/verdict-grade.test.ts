import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentDefinition, claude, customAgent, openai } from "@post-print/agent-harness";
import { TestRuntime } from "../sdk/runtime.js";

const roots: string[] = [];
afterEach(async () => {
	delete process.env.AGENT_TEST_VERDICT_GRADE;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
/** Runs one agent under --verdict-grade: why it was refused, and whether a host ever started. */
async function refusal(agent: AgentDefinition): Promise<string> {
	process.env.AGENT_TEST_VERDICT_GRADE = "1";
	const root = await mkdtemp(join(tmpdir(), "verdict-grade-"));
	roots.push(root);
	await mkdir(join(root, "source"));
	const runtime = new TestRuntime({
		baseDir: root,
		outputDir: join(root, "runs"),
		workspace: "source",
		signal: new AbortController().signal,
		agent,
	});
	try {
		await runtime.agent("subject", {}).run({ prompt: "answer" });
		return "";
	} catch (error) {
		const started = runtime.failedBeforeAnyHostStarted() ? "" : " (after a host started)";
		return `${(error as Error).message}${started}`;
	} finally {
		await runtime.close();
	}
}
it("--verdict-grade refuses subscription auth, project context, and unsealable hosts", async () => {
	expect(await refusal(claude())).toContain("it uses subscription auth");
	expect(await refusal(claude())).not.toContain("after a host started");
	const projectContext = claude({ auth: { type: "api-key", env: "KEY" } });
	expect(await refusal(projectContext)).toContain("Claude loads project context");
	const globalSkills = openai({ auth: { type: "api-key", env: "KEY" }, includeGlobalSkills: true });
	expect(await refusal(globalSkills)).toContain("it includes global skills");
	const custom = customAgent({ adapter: "file:///nowhere.mjs", options: {} });
	expect(await refusal(custom)).toContain("a custom adapter cannot seal its runs");
});
