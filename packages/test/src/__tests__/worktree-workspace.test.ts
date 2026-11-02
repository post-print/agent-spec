import { afterEach, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type AgentDefinition, claude, customAgent } from "@post-print/agent-harness";
import { type AcceptedConditions, recordWeaknesses } from "../sdk/claim-strength.js";
import { TestRuntime } from "../sdk/runtime.js";
import { reduceVerdict } from "../sdk/verdict.js";

const git = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
	delete process.env.AGENT_TEST_VERDICT_GRADE;
	delete process.env.CLAUDE_CODE_BIN;
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
/** What PostPrint's suite accepts once the built-in host states that user settings stay out. */
const UNCONFINED_CLAUDE: AcceptedConditions = {
	conditions: ["calibration", "confinement"],
	reason: "the task needs real containers",
};
const ALLOWED_TOOLS = ["Read", "Bash(bun run dev:status)"];
/**
 * A fake Claude Code binary. A run writes its arguments and environment beside its own folder,
 * changes a file, and ends the stream with a successful result.
 */
async function fakeClaude(root: string): Promise<{ bin: string; seen: string }> {
	const bin = join(root, "..", `${root.split("/").pop()}-claude`);
	const seen = `${bin}.seen`;
	const result = '{"type":"result","subtype":"success","is_error":false,"result":"done"}';
	await writeFile(
		bin,
		`#!/bin/sh\n[ "$1" = --version ] && echo '2.1.300 (Claude Code)' && exit 0\nprintf '%s\\n' "$@" > '${seen}'\nenv >> '${seen}'\ntouch changed.txt\necho '${result}'\n`,
	);
	await chmod(bin, 0o755);
	roots.push(bin, seen);
	return { bin, seen };
}
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
it("an unconfined claude() runs in a worktree, scrubbed of its parent session, and ends accepted", async () => {
	const root = await repo();
	const { bin, seen } = await fakeClaude(root);
	process.env.CLAUDE_CODE_BIN = bin;
	process.env.CLAUDECODE = "1";
	process.env.CLAUDE_CODE_ENTRYPOINT = "parent-session";
	const agent = claude({ confinement: "none", allowedTools: ALLOWED_TOOLS, model: "pinned" });
	const owner = runtime(root, agent, UNCONFINED_CLAUDE);
	try {
		const run = await owner.agent("worker", {}).run({ prompt: "pass" });
		expect(run.workspace.changedPaths).toEqual(["changed.txt"]);
		expect(run.record).toMatchObject({
			confinement: "detect-only",
			userConfig: "excluded",
			allowedTools: ALLOWED_TOOLS,
			workspace: { kind: "worktree" },
		});
		expect(recordWeaknesses(run.record).map(({ condition }) => condition)).toEqual([
			"calibration",
			"confinement",
		]);
		const attempt = { testId: "a", retry: 0, status: "passed", errors: [] };
		const operations = [{ data: [{ record: run.record }] }];
		const verdict = reduceVerdict({
			attempts: [{ ...attempt, operations }],
			interrupted: false,
			listOnly: false,
			runnerExitCode: 0,
		});
		expect(verdict).toMatchObject({ verdict: "accepted", exitCode: 0 });
	} finally {
		delete process.env.CLAUDECODE;
		delete process.env.CLAUDE_CODE_ENTRYPOINT;
		await owner.close();
	}
	const lines = (await readFile(seen, "utf8")).split("\n");
	expect(
		lines.filter((line) => line.startsWith("CLAUDE_CODE") || line.startsWith("CLAUDECODE")),
	).toEqual([]);
	expect(lines[lines.indexOf("--permission-mode") + 1]).toBe("default");
	expect(lines).not.toContain("bypassPermissions");
	expect(lines[lines.indexOf("--allowedTools") + 1]).toBe(ALLOWED_TOOLS.join(","));
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
	expect(await refusal(claude(), UNCONFINED)).toContain("not a sandboxed claude host");
	process.env.AGENT_TEST_VERDICT_GRADE = "1";
	expect(await refusal(STORAGE, UNCONFINED)).toContain("--verdict-grade");
	const unconfined = claude({ confinement: "none", allowedTools: ALLOWED_TOOLS });
	expect(await refusal(unconfined, UNCONFINED_CLAUDE)).toContain("--verdict-grade");
});
