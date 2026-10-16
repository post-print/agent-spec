import { expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	createSealedWorkspace,
	defaultSealedOverlayPaths,
	parseScenarioWorkspace,
	toolPathsOutsideWorkspace,
} from "../sealed-workspace.js";

const execFileAsync = promisify(execFile);

async function initRepo(): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "sealed-src-"));
	await execFileAsync("git", ["init", "-b", "main"], { cwd: repo });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
	await execFileAsync("git", ["config", "user.name", "test"], { cwd: repo });
	await mkdir(join(repo, ".agents/skills/probe"), { recursive: true });
	await mkdir(join(repo, ".agents/skills/grill"), { recursive: true });
	await writeFile(join(repo, "AGENTS.md"), "# committed\n", "utf8");
	await writeFile(join(repo, ".agents/skills/probe/SKILL.md"), "# Probe\n", "utf8");
	await writeFile(join(repo, ".agents/skills/grill/SKILL.md"), "# Grill\n", "utf8");
	await mkdir(join(repo, "src"), { recursive: true });
	await writeFile(join(repo, "src/app.ts"), "export const n = 1;\n", "utf8");
	await execFileAsync("git", ["add", "."], { cwd: repo });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd: repo });
	await writeFile(join(repo, "AGENTS.md"), "# uncommitted overlay\n", "utf8");
	return repo;
}

it("parseScenarioWorkspace › treats omit, empty, and dot as caller HEAD", () => {
	expect(parseScenarioWorkspace(undefined)).toEqual({ ok: true, rel: undefined });
	expect(parseScenarioWorkspace("")).toEqual({ ok: true, rel: undefined });
	expect(parseScenarioWorkspace(".")).toEqual({ ok: true, rel: undefined });
	expect(parseScenarioWorkspace("./")).toEqual({ ok: true, rel: undefined });
});

it("parseScenarioWorkspace › accepts a repo-relative folder", () => {
	expect(parseScenarioWorkspace("./agent-suites/depth/workspaces/seed")).toEqual({
		ok: true,
		rel: "agent-suites/depth/workspaces/seed",
	});
});

it("parseScenarioWorkspace › rejects absolute paths and parent segments", () => {
	expect(parseScenarioWorkspace("/tmp/fixture").ok).toBe(false);
	expect(parseScenarioWorkspace("agent-suites/../packages").ok).toBe(false);
	expect(parseScenarioWorkspace(1).ok).toBe(false);
});

it("createSealedWorkspace › copies HEAD files and overlays caller context", async () => {
	const repo = await initRepo();
	const sealed = await createSealedWorkspace({
		callerCwd: repo,
		overlayPaths: ["AGENTS.md", ".agents/skills/probe/SKILL.md"],
	});
	try {
		expect(await readFile(join(sealed.path, "src/app.ts"), "utf8")).toContain("export const n");
		expect(await readFile(join(sealed.path, "AGENTS.md"), "utf8")).toContain("uncommitted overlay");
		expect(await readFile(join(sealed.path, ".agents/skills/probe/SKILL.md"), "utf8")).toContain(
			"Probe",
		);
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd: sealed.path,
		});
		expect(realpathSync(stdout.trim())).toBe(realpathSync(sealed.path));
	} finally {
		await sealed.cleanup();
	}
});

it("createSealedWorkspace › keeps committed skill trees so the host can load them", async () => {
	expect(defaultSealedOverlayPaths()).toEqual(
		expect.arrayContaining(["AGENTS.md", ".agents/skills", ".claude/skills", ".codex/skills"]),
	);
	const repo = await initRepo();
	const sealed = await createSealedWorkspace({
		callerCwd: repo,
		overlayPaths: defaultSealedOverlayPaths(),
	});
	try {
		expect(await readFile(join(sealed.path, ".agents/skills/probe/SKILL.md"), "utf8")).toContain(
			"Probe",
		);
		expect(await readFile(join(sealed.path, ".agents/skills/grill/SKILL.md"), "utf8")).toContain(
			"Grill",
		);
	} finally {
		await sealed.cleanup();
	}
});

it("createSealedWorkspace › copies a workspace folder without parent HEAD files", async () => {
	const repo = await initRepo();
	await mkdir(join(repo, "agent-suites/depth/workspaces/seed"), { recursive: true });
	await writeFile(
		join(repo, "agent-suites/depth/workspaces/seed/seeded.txt"),
		"fixture only\n",
		"utf8",
	);
	const sealed = await createSealedWorkspace({
		callerCwd: repo,
		workspace: "agent-suites/depth/workspaces/seed",
		overlayPaths: defaultSealedOverlayPaths(),
	});
	try {
		expect(await readFile(join(sealed.path, "seeded.txt"), "utf8")).toContain("fixture only");
		await expect(readFile(join(sealed.path, "src/app.ts"), "utf8")).rejects.toThrow();
		await expect(readFile(join(sealed.path, "AGENTS.md"), "utf8")).rejects.toThrow();
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
			cwd: sealed.path,
		});
		expect(realpathSync(stdout.trim())).toBe(realpathSync(sealed.path));
	} finally {
		await sealed.cleanup();
	}
});

it("toolPathsOutsideWorkspace › ignores Cursor files that hold large tool output", () => {
	const escaped = toolPathsOutsideWorkspace(
		{
			messages: [],
			toolCalls: [
				{
					name: "Read",
					args: { path: "/tmp/cursor-home/.cursor/projects/workspace/agent-tools/output.txt" },
				},
			],
			shellCommands: [],
			artifacts: {},
		},
		"/tmp/sealed-workspace",
	);
	expect(escaped).toEqual([]);
});

it("toolPathsOutsideWorkspace › flags absolute and parent-escape paths", () => {
	const workspace = "/tmp/agent-seal/run-1";
	const escaped = toolPathsOutsideWorkspace(
		{
			messages: [],
			toolCalls: [
				{ name: "Read", args: { path: "AGENTS.md" } },
				{ name: "Read", args: { path: "/etc/passwd" } },
				{ name: "Read", args: { path: "../secret.md" } },
			],
			shellCommands: [],
			artifacts: {},
		},
		workspace,
	);
	expect(escaped).toEqual(["/etc/passwd", "../secret.md"]);
});

it("toolPathsOutsideWorkspace › flags an outside path inside a shell command", () => {
	const skill = join(tmpdir(), "example-home/.agents/skills/private/SKILL.md");
	const escaped = toolPathsOutsideWorkspace(
		{
			messages: [],
			toolCalls: [
				{
					name: "Shell",
					args: {
						command: `/bin/zsh -lc "pwd && cat ${skill}"`,
						cwd: "/tmp/agent-seal/run-1",
					},
				},
			],
			shellCommands: [],
			artifacts: {},
		},
		"/tmp/agent-seal/run-1",
	);
	expect(escaped).toEqual([skill]);
});

it("toolPathsOutsideWorkspace › does not flag a read through the real path of a symlink workspace", async () => {
	const realRoot = await mkdtemp(join(tmpdir(), "seal-real-"));
	const file = join(realRoot, "SKILL.md");
	await writeFile(file, "# skill\n");
	const linkParent = await mkdtemp(join(tmpdir(), "seal-link-"));
	const linkRoot = join(linkParent, "seal");
	await symlink(realRoot, linkRoot);
	expect(
		toolPathsOutsideWorkspace(
			{
				messages: [],
				toolCalls: [{ name: "Read", args: { path: realpathSync(file) } }],
				shellCommands: [],
				artifacts: {},
			},
			linkRoot,
		),
	).toEqual([]);
});

function shellTrace(command: string, cwd?: string) {
	return {
		messages: [],
		toolCalls: [{ name: "Shell", args: { command, ...(cwd ? { cwd } : {}) } }],
		shellCommands: [],
		artifacts: {},
	};
}

async function sealedLayout() {
	const parent = realpathSync(await mkdtemp(join(tmpdir(), "seal-escape-")));
	const workspace = join(parent, "workspace");
	await mkdir(join(workspace, "src"), { recursive: true });
	return { parent, workspace };
}

it("toolPathsOutsideWorkspace › flags shell reads of the caller repo, the manifest, and parents", async () => {
	const { parent, workspace } = await sealedLayout();
	const spec = join(parent, "repo", "agent-suites", "tour.spec.ts");
	const cases = [
		[`/bin/zsh -lc "cat ${spec}"`, [spec]],
		['/bin/zsh -lc "cat ../owner.json"', ["../owner.json"]],
		["cd ../.. && ls", ["../.."]],
		["cat ~/notes.md", ["~/notes.md"]],
		["cat $HOME/notes.md", ["$HOME/notes.md"]],
	] as const;
	for (const [command, expected] of cases)
		expect(toolPathsOutsideWorkspace(shellTrace(command, workspace), workspace)).toEqual([
			...expected,
		]);
});

it("toolPathsOutsideWorkspace › allows system toolchains, patterns, and in-workspace cd", async () => {
	const { workspace } = await sealedLayout();
	const allowed = [
		'/bin/zsh -lc "bun test"',
		"ls /usr/bin",
		"awk '/completedAt/ {print}' src/status.ts",
		"cd src && cat ../PROJECT.md",
		"bun test 2>/dev/null",
	];
	for (const command of allowed)
		expect(toolPathsOutsideWorkspace(shellTrace(command, workspace), workspace)).toEqual([]);
});

it("toolPathsOutsideWorkspace › resolves relative shell paths against the tool cwd", async () => {
	const { workspace } = await sealedLayout();
	const nested = join(workspace, "src");
	expect(toolPathsOutsideWorkspace(shellTrace("cat ../PROJECT.md", nested), workspace)).toEqual([]);
	expect(toolPathsOutsideWorkspace(shellTrace("cat ../../x", nested), workspace)).toEqual([
		"../../x",
	]);
});

it("toolPathsOutsideWorkspace › flags an absolute Glob pattern outside the workspace", async () => {
	const { parent, workspace } = await sealedLayout();
	const trace = {
		messages: [],
		toolCalls: [{ name: "Glob", args: { pattern: `${parent}/**/*.ts` } }],
		shellCommands: [],
		artifacts: {},
	};
	expect(toolPathsOutsideWorkspace(trace, workspace)).toEqual([`${parent}/**/*.ts`]);
});

/** The literal shell text `${PWD}`, built without a template-looking string literal. */
const BRACED_PWD = ["$", "{PWD}"].join("");

const shellCalls = (...commands: string[]) => ({
	messages: [],
	toolCalls: commands.map((command) => ({ name: "Shell", args: { command } })),
	shellCommands: [],
	artifacts: {},
});

it("toolPathsOutsideWorkspace › follows a cd that persists across shell calls", () => {
	const escaped = toolPathsOutsideWorkspace(
		shellCalls("cd projects/pr-lab", "cat ../../.agents/skills/review/SKILL.md"),
		"/tmp/sealed-workspace",
	);
	expect(escaped).toEqual([]);
});

it("toolPathsOutsideWorkspace › still flags a parent path that leaves the workspace after a cd", () => {
	const escaped = toolPathsOutsideWorkspace(
		shellCalls("cd projects", "cat ../../outside.txt"),
		"/tmp/sealed-workspace",
	);
	expect(escaped).toEqual(["../../outside.txt"]);
});

it("toolPathsOutsideWorkspace › resolves $PWD against the shell directory", () => {
	expect(
		toolPathsOutsideWorkspace(
			shellCalls("cd projects/app && mkdir -p $PWD/../../_evidence/tmp"),
			"/tmp/sealed-workspace",
		),
	).toEqual([]);
	expect(
		toolPathsOutsideWorkspace(shellCalls(`cat ${BRACED_PWD}/../secret`), "/tmp/sealed-workspace"),
	).toEqual([`${BRACED_PWD}/../secret`]);
});

it("toolPathsOutsideWorkspace › an explicit per-call cwd does not move the shell", () => {
	const trace = {
		messages: [],
		toolCalls: [
			{ name: "Shell", args: { command: "ls", cwd: "/tmp/sealed-workspace/projects/app" } },
			{ name: "Shell", args: { command: "cat ../x" } },
		],
		shellCommands: [],
		artifacts: {},
	};
	expect(toolPathsOutsideWorkspace(trace, "/tmp/sealed-workspace")).toEqual(["../x"]);
});

it("toolPathsOutsideWorkspace › follows Codex's per-call workdir", () => {
	const trace = {
		messages: [],
		toolCalls: [
			{
				name: "Shell",
				args: { command: "cat ../../.agents/skills/x/SKILL.md", workdir: "projects/app" },
			},
		],
		shellCommands: [],
		artifacts: {},
	};
	expect(toolPathsOutsideWorkspace(trace, "/tmp/sealed-workspace")).toEqual([]);
});

it("toolPathsOutsideWorkspace › allows the host's own scratch folder and browser toolchain", () => {
	const uid = process.getuid?.() ?? 0;
	expect(
		toolPathsOutsideWorkspace(
			shellCalls(
				`node /private/tmp/claude-${uid}/session/scratchpad/probe.mjs`,
				"ls /Applications/Google\\ Chrome.app ~/Library/Caches/ms-playwright",
			),
			"/tmp/sealed-workspace",
		),
	).toEqual([]);
});

it("toolPathsOutsideWorkspace › still flags the user's home and global skills", () => {
	expect(
		toolPathsOutsideWorkspace(
			shellCalls("ls ~/.claude/skills ~/.agents/skills", "cat ~/notes.txt"),
			"/tmp/sealed-workspace",
		),
	).toEqual(["~/.claude/skills", "~/.agents/skills", "~/notes.txt"]);
});

it("toolPathsOutsideWorkspace › ignores paths inside a heredoc body", async () => {
	const { workspace } = await sealedLayout();
	const command = `/bin/zsh -lc "cat > src/check.mjs <<'EOF'\nimport { a } from '../../outside.mjs'\nEOF\nnode src/check.mjs"`;
	expect(toolPathsOutsideWorkspace(shellTrace(command), workspace)).toEqual([]);
});

it("toolPathsOutsideWorkspace › follows a cd on an earlier line of the same command", async () => {
	const { workspace } = await sealedLayout();
	await writeFile(join(workspace, "PROJECT.md"), "");
	const command = `/bin/zsh -lc 'cd src\ncat ../PROJECT.md'`;
	expect(toolPathsOutsideWorkspace(shellTrace(command), workspace)).toEqual([]);
});

it("toolPathsOutsideWorkspace › allows a parent path that names a workspace file from an unrecorded subfolder", async () => {
	const { workspace } = await sealedLayout();
	await mkdir(join(workspace, ".agents/skills/x/scripts"), { recursive: true });
	await writeFile(join(workspace, ".agents/skills/x/scripts/status.mjs"), "");
	expect(
		toolPathsOutsideWorkspace(
			shellTrace("node ../../.agents/skills/x/scripts/status.mjs"),
			workspace,
		),
	).toEqual([]);
	expect(
		toolPathsOutsideWorkspace(shellTrace("cat ../../../Users/someone/.ssh/id_rsa"), workspace),
	).toEqual(["../../../Users/someone/.ssh/id_rsa"]);
	expect(toolPathsOutsideWorkspace(shellTrace("cat ../owner.json"), workspace)).toEqual([
		"../owner.json",
	]);
});

it("toolPathsOutsideWorkspace › reads a path inside escaped quotes without the escape", async () => {
	const { workspace } = await sealedLayout();
	await writeFile(join(workspace, "src", "export.mjs"), "");
	const command = `/bin/zsh -lc "node -e \\"import(\\\\\\"../src/export.mjs\\\\\\")\\""`;
	expect(toolPathsOutsideWorkspace(shellTrace(command), workspace)).toEqual([]);
});
