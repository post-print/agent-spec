import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createAdapter } from "../adapters/index.js";
import { loadContext } from "../context.js";

async function fixtureRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "agent-harness-ctx-"));
	await writeFile(join(dir, "AGENTS.md"), "# Agents\nAmbient routing tips\n", "utf8");
	await mkdir(join(dir, ".claude/skills"), { recursive: true });
	await writeFile(join(dir, ".claude/skills/README.md"), "# Skills\n", "utf8");
	await mkdir(join(dir, ".cursor/rules"), { recursive: true });
	await writeFile(join(dir, ".cursor/rules/coding.mdc"), "# coding\n", "utf8");
	await mkdir(join(dir, ".claude/skills/grill"), { recursive: true });
	await writeFile(join(dir, ".claude/skills/grill/SKILL.md"), "# Grill\n", "utf8");
	return dir;
}

describe("loadContext", () => {
	it("loads shared sources from repo root", async () => {
		const repoRoot = await fixtureRepo();
		const context = await loadContext({ cwd: repoRoot, profile: "shared" });
		expect(context.sources).toContain("AGENTS.md");
		expect(context.sources).toContain(".claude/skills/README.md");
		expect(context.preamble).toContain("Ambient routing");
	});

	it("loads .cursor/rules for cursor profile", async () => {
		const repoRoot = await fixtureRepo();
		const context = await loadContext({ cwd: repoRoot, profile: "cursor" });
		expect(context.sources.some((s) => s.startsWith(".cursor/rules/"))).toBe(true);
		expect(context.preamble).toContain("coding.mdc");
	});

	it("loads full skill catalog for cursor profile with skills full", async () => {
		const repoRoot = await fixtureRepo();
		const context = await loadContext({ cwd: repoRoot, profile: "cursor", skills: "full" });
		expect(context.skillsMode).toBe("full");
		expect(context.sources.some((s) => s.includes("grill/SKILL.md"))).toBe(true);
		expect(context.preamble).toContain("## Skill catalog");
	});

	it("loads skeleton registry + config summary and alwaysInclude paths", async () => {
		const repoRoot = await fixtureRepo();
		await mkdir(join(repoRoot, ".skeleton/customize"), { recursive: true });
		await writeFile(
			join(repoRoot, ".skeleton/registry.md"),
			"# Registry\n| Topic | File |\n",
			"utf8",
		);
		await writeFile(
			join(repoRoot, ".skeleton/config.yaml"),
			[
				"scan:",
				"  include:",
				'    - "AGENTS.md"',
				"customize:",
				"  alwaysInclude:",
				"    - tip.md",
				"",
			].join("\n"),
			"utf8",
		);
		await writeFile(
			join(repoRoot, ".skeleton/customize/tip.md"),
			"# Tip\nkeep registry first\n",
			"utf8",
		);

		const context = await loadContext({ cwd: repoRoot, profile: "skeleton" });
		expect(context.sources).toContain(".skeleton/registry.md");
		expect(context.sources).toContain(".skeleton/config.yaml");
		expect(context.sources).toContain(".skeleton/customize/tip.md");
		expect(context.preamble).toContain("keep registry first");
	});

	it("keeps shared profile unchanged when contextSources are omitted", async () => {
		const repoRoot = await fixtureRepo();
		const context = await loadContext({ cwd: repoRoot, profile: "shared" });
		expect(context.sources).not.toContain(".skeleton/registry.md");
	});

	it("loads additive contextSources on shared profile", async () => {
		const repoRoot = await fixtureRepo();
		await mkdir(join(repoRoot, ".skeleton"), { recursive: true });
		await writeFile(join(repoRoot, ".skeleton/registry.md"), "# Registry\n", "utf8");
		const context = await loadContext({
			cwd: repoRoot,
			profile: "shared",
			contextSources: [".skeleton/registry.md"],
		});
		expect(context.sources).toContain(".skeleton/registry.md");
	});
});

describe("createAdapter", () => {
	it("rejects the deprecated replay host for untyped callers", () => {
		expect(() => createAdapter("replay" as never)).toThrow(
			"Replay-based testing is deprecated and no longer supported",
		);
	});
});
