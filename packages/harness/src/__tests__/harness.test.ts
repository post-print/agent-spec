import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ReplayAdapter } from "../adapters/replay";
import { loadContext } from "../context";

const INVALID_REPLAY_TRACE = /invalid replay trace/i;

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
});

describe("ReplayAdapter", () => {
	it("fails without replayTracePath", async () => {
		const adapter = new ReplayAdapter();
		const repoRoot = await fixtureRepo();
		const context = await loadContext({ cwd: repoRoot });
		const session = await adapter.run({
			host: "replay",
			cwd: context.cwd,
			context,
			prompt: "test",
		});
		expect(session.status).toBe("failed");
	});

	it("fails on malformed JSON", async () => {
		const adapter = new ReplayAdapter();
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-"));
		const tracePath = join(dir, "broken.json");
		await writeFile(tracePath, "{not json");
		const context = await loadContext({ cwd: dir });
		const session = await adapter.run({
			host: "replay",
			cwd: dir,
			context,
			prompt: "test",
			replayTracePath: tracePath,
		});
		expect(session.status).toBe("failed");
		expect(session.error).toMatch(INVALID_REPLAY_TRACE);
	});

	it("fails on invalid trace shape", async () => {
		const adapter = new ReplayAdapter();
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-"));
		const tracePath = join(dir, "shape.json");
		await writeFile(tracePath, JSON.stringify({ foo: "bar" }));
		const context = await loadContext({ cwd: dir });
		const session = await adapter.run({
			host: "replay",
			cwd: dir,
			context,
			prompt: "test",
			replayTracePath: tracePath,
		});
		expect(session.status).toBe("failed");
		expect(session.error).toMatch(INVALID_REPLAY_TRACE);
	});
});
