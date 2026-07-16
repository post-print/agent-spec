import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSkillContext, normalizeSkillContext } from "../skills-context.js";

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

	it("builds catalog index without full bodies", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, "catalog");
		expect(loaded.mode).toBe("catalog");
		expect(loaded.preamble).toContain("## Skill catalog");
		expect(loaded.preamble).toContain("grill");
		expect(loaded.preamble).toContain(".claude/skills/grill/SKILL.md");
		expect(loaded.preamble).not.toContain("# Grill\n");
	});

	it("loads full SKILL.md bodies in full mode", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, "full");
		expect(loaded.mode).toBe("full");
		expect(loaded.preamble).toContain("# Grill");
		expect(loaded.preamble).toContain("# Crystallize");
		expect(loaded.sources.some((s) => s.endsWith("grill/SKILL.md"))).toBe(true);
	});

	it("excludes internal align-commands skill", async () => {
		const repoRoot = await fixtureRepo();
		const loaded = await loadSkillContext(repoRoot, "catalog");
		expect(loaded.catalog.some((skill) => skill.name === "align-commands")).toBe(false);
	});

	it("normalizes string settings", () => {
		expect(normalizeSkillContext("full")).toEqual({ mode: "full" });
	});
});
