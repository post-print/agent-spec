import { describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	createSealedWorkspace,
	defaultSealedOverlayPaths,
	toolPathsOutsideWorkspace,
} from "../sealed-workspace.js";
import { loadSkillContext } from "../skills-context.js";

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

describe("createSealedWorkspace", () => {
	it("copies HEAD files and overlays caller context", async () => {
		const repo = await initRepo();
		const sealed = await createSealedWorkspace({
			callerCwd: repo,
			overlayPaths: ["AGENTS.md", ".agents/skills/probe/SKILL.md"],
		});
		try {
			expect(await readFile(join(sealed.path, "src/app.ts"), "utf8")).toContain("export const n");
			expect(await readFile(join(sealed.path, "AGENTS.md"), "utf8")).toContain(
				"uncommitted overlay",
			);
			expect(await readFile(join(sealed.path, ".agents/skills/probe/SKILL.md"), "utf8")).toContain(
				"Probe",
			);
			const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
				cwd: sealed.path,
			});
			expect(realpathSync(stdout.trim())).toBe(realpathSync(sealed.path));
			const skills = await loadSkillContext(sealed.path, [".agents/skills/probe/SKILL.md"]);
			expect(skills.preamble).toContain(".agents/skills/probe/SKILL.md");
		} finally {
			await sealed.cleanup();
		}
	});

	it("keeps committed skill trees so the host can load them", async () => {
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
});

describe("toolPathsOutsideWorkspace", () => {
	it("flags absolute and parent-escape paths", () => {
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

	it("does not flag a read through the real path of a symlink workspace", async () => {
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
});
