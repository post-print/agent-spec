import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	isRepoRelativeSkillPath,
	loadSkillContext,
	normalizeSkillContext,
	SKILL_ROOTS,
	type SkillContextSetting,
	skillOverlayRelPath,
	skillPathsFromSetting,
} from "../skills-context.js";

async function fixtureRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "skills-ctx-"));
	await mkdir(join(dir, ".claude/skills/grill"), { recursive: true });
	await mkdir(join(dir, ".claude/skills/crystallize"), { recursive: true });
	await mkdir(join(dir, ".claude/skills/align-commands"), { recursive: true });
	await writeFile(
		join(dir, ".claude/skills/README.md"),
		"# Skills\n- grill\n- crystallize\n",
		"utf8",
	);
	await writeFile(join(dir, ".claude/skills/grill/SKILL.md"), "# Grill\nbody\n", "utf8");
	await writeFile(
		join(dir, ".claude/skills/crystallize/SKILL.md"),
		"# Crystallize\nbody\n",
		"utf8",
	);
	await writeFile(
		join(dir, ".claude/skills/align-commands/SKILL.md"),
		"# Align\ninternal\n",
		"utf8",
	);
	return dir;
}

describe("skills-context", () => {
	it("returns empty preamble for none mode", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, "none");
		expect(loaded.mode).toBe("none");
		expect(loaded.preamble).toBe("");
	});

	it("loads only the listed skill paths", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, [".claude/skills/grill/SKILL.md"]);
		expect(loaded.mode).toBe("catalog");
		expect(loaded.catalog.map((skill) => skill.relPath)).toEqual([".claude/skills/grill/SKILL.md"]);
		expect(loaded.preamble).toContain("<!-- skills/catalog -->");
		expect(loaded.preamble).toContain("## Skill catalog");
		expect(loaded.preamble).toContain(".claude/skills/grill/SKILL.md");
		expect(loaded.preamble).not.toContain("crystallize");
		expect(loaded.preamble).not.toContain("# Grill\n");
	});

	it("accepts a skill folder path", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, [".claude/skills/grill"]);
		expect(loaded.catalog.map((skill) => skill.relPath)).toEqual([".claude/skills/grill/SKILL.md"]);
	});

	it("loads full SKILL.md bodies for listed paths", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, {
			mode: "full",
			include: [".claude/skills/grill/SKILL.md"],
		});
		expect(loaded.mode).toBe("full");
		expect(loaded.preamble).toContain("# Grill");
		expect(loaded.preamble).not.toContain("# Crystallize");
		expect(loaded.sources.some((source) => source.endsWith("grill/SKILL.md"))).toBe(true);
	});

	it("rejects a named internal skill path", async () => {
		const repoRoot = await fixtureRepo();
		await expect(
			loadSkillContext(repoRoot, [".claude/skills/align-commands/SKILL.md"]),
		).rejects.toThrow(/skill not found/);
	});

	it("rejects a bare skill name", () => {
		expect(() => normalizeSkillContext(["grill"] as SkillContextSetting)).toThrow(/repo-relative/);
		expect(isRepoRelativeSkillPath("grill")).toBe(false);
		expect(isRepoRelativeSkillPath(".agents/skills/skeleton/SKILL.md")).toBe(true);
		expect(isRepoRelativeSkillPath("../secret/SKILL.md")).toBe(false);
	});

	it("rejects catalog mode without paths", () => {
		expect(() => normalizeSkillContext("catalog" as SkillContextSetting)).toThrow(
			/list of skill paths/,
		);
		expect(() => normalizeSkillContext({ mode: "full" } as SkillContextSetting)).toThrow(
			/skills.include/,
		);
	});

	it("reads skillPathsFromSetting from an array", () => {
		expect(skillPathsFromSetting([".agents/skills/skeleton/SKILL.md"])).toEqual([
			".agents/skills/skeleton/SKILL.md",
		]);
		expect(skillPathsFromSetting("none")).toEqual([]);
		expect(skillOverlayRelPath(".agents/skills/skeleton/SKILL.md")).toBe(".agents/skills/skeleton");
	});

	it("resolves a Cursor .agents skill by path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skills-agents-"));
		await mkdir(join(dir, ".agents/skills/probe"), { recursive: true });
		await writeFile(join(dir, ".agents/skills/probe/SKILL.md"), "# Probe\nbody\n", "utf8");
		const loaded = await loadSkillContext(dir, [".agents/skills/probe/SKILL.md"]);
		expect(loaded.catalog.map((skill) => skill.relPath)).toEqual([".agents/skills/probe/SKILL.md"]);
	});

	it("lists Cursor, Claude, and Codex skill roots", () => {
		expect([...SKILL_ROOTS]).toEqual([
			".agents/skills",
			".cursor/skills",
			".codex/skills",
			".claude/skills",
		]);
	});

	it("resolves a named .codex skill path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skills-codex-"));
		await mkdir(join(dir, ".codex/skills/origin"), { recursive: true });
		await writeFile(join(dir, ".codex/skills/origin/SKILL.md"), "---\nname: origin\n---\n", "utf8");
		const loaded = await loadSkillContext(dir, [".codex/skills/origin/SKILL.md"]);
		expect(loaded.catalog.map((skill) => skill.dir)).toEqual(["origin"]);
		expect(loaded.preamble).toContain(".codex/skills/origin/SKILL.md");
	});

	it("loads only the path the suite named when two hosts share a skill", async () => {
		const dir = await mkdtemp(join(tmpdir(), "skills-dedupe-"));
		await mkdir(join(dir, ".agents/skills/grill"), { recursive: true });
		await mkdir(join(dir, ".claude/skills/grill"), { recursive: true });
		await writeFile(
			join(dir, ".agents/skills/grill/SKILL.md"),
			"---\nname: grill\n---\nA\n",
			"utf8",
		);
		await writeFile(
			join(dir, ".claude/skills/grill/SKILL.md"),
			"---\nname: grill\n---\nB\n",
			"utf8",
		);
		const loaded = await loadSkillContext(dir, [".agents/skills/grill/SKILL.md"]);
		expect(loaded.catalog).toHaveLength(1);
		expect(loaded.catalog[0]?.relPath).toBe(".agents/skills/grill/SKILL.md");
	});
});
