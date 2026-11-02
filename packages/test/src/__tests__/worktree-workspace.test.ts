import { afterEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type AgentDefinition, claude, customAgent } from "@post-print/agent-harness";
import type { AcceptedConditions } from "../sdk/claim-strength.js";
import { TestRuntime } from "../sdk/runtime.js";

const git = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
	delete process.env.AGENT_TEST_VERDICT_GRADE;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const STORAGE = customAgent({
	adapter: new URL("./fixtures/storage-agent.mjs", import.meta.url).href,
	options: {},
});
const UNCONFINED: AcceptedConditions = {
	conditions: ["calibration", "confinement", "user-config"],
	reason: "a real worktree",
};
async function repo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "worktree-repo-"));
	roots.push(root);
	await git("git", ["init", "-b", "main"], { cwd: root });
	await git("git", ["config", "user.email", "test@example.com"], { cwd: root });
	await git("git", ["config", "user.name", "test"], { cwd: root });
	await writeFile(join(root, "README.md"), "# real repo\n");
	await git("git", ["add", "-A"], { cwd: root });
	await git("git", ["commit", "-m", "init"], { cwd: root });
	return root;
}
function runtime(root: string, agent: AgentDefinition, accepted?: AcceptedConditions) {
	return new TestRuntime({
		baseDir: root,
		outputDir: join(root, "..", `${root.split("/").pop()}-runs`),
		workspace: { worktree: "." },
		agent,
		accepted,
		signal: new AbortController().signal,
	});
}
async function worktreeCount(root: string): Promise<number> {
	const { stdout } = await git("git", ["-C", root, "worktree", "list", "--porcelain"]);
	return stdout.split("\n").filter((line) => line.startsWith("worktree ")).length;
}
it("a worktree workspace runs a custom adapter in the real repository and leaves no worktree", async () => {
	const root = await repo();
	const owner = runtime(root, STORAGE, UNCONFINED);
	try {
		const run = await owner.agent("worker", {}).run({ prompt: "pass" });
		expect(run.workspace.initial.files["README.md"]).toBeDefined();
		expect(run.workspace.changedPaths).toEqual(["changed.txt"]);
		expect(run.record.workspace).toMatchObject({ kind: "worktree", repo: ".", ref: "HEAD" });
		expect(run.record.workspace?.sha).toHaveLength(40);
	} finally {
		await owner.close();
	}
	expect(await worktreeCount(root)).toBe(1);
});
it("a worktree workspace is refused without accepted confinement, on a built-in host, or under --verdict-grade", async () => {
	const refusal = async (agent: AgentDefinition, accepted?: AcceptedConditions) => {
		const owner = runtime(await repo(), agent, accepted);
		try {
			await owner.agent("worker", {}).run({ prompt: "pass" });
			return "";
		} catch (error) {
			return (error as Error).message;
		} finally {
			await owner.close();
		}
	};
	expect(await refusal(STORAGE)).toContain("must accept confinement");
	expect(await refusal(claude(), UNCONFINED)).toContain("only with a custom adapter");
	process.env.AGENT_TEST_VERDICT_GRADE = "1";
	expect(await refusal(STORAGE, UNCONFINED)).toContain("--verdict-grade");
});
