import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadContext } from "../context.js";

describe("contextSources", () => {
	it("loads a workspace-relative bare filename", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-ctxsrc-"));
		await writeFile(join(dir, "AGENTS.md"), "# Depth context workspace\n", "utf8");
		await writeFile(
			join(dir, "brief.md"),
			"DEPTH_CONTEXT token: agent-test-depth-context-6d2a\n",
			"utf8",
		);
		await mkdir(join(dir, ".skeleton/customize"), { recursive: true });

		const context = await loadContext({
			cwd: dir,
			profile: "cursor",
			contextSources: ["brief.md"],
		});

		expect(context.sources).toContain("brief.md");
		expect(context.sources).not.toContain(".skeleton/customize/brief.md");
		expect(context.preamble).toContain("agent-test-depth-context-6d2a");
	});

	it("rejects prompt-only context in host-native mode", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-native-context-"));
		await writeFile(join(dir, "brief.md"), "hidden", "utf8");
		await expect(
			loadContext({ cwd: dir, mode: "host-native", contextSources: ["brief.md"] }),
		).rejects.toThrow("does not allow contextSources prompt injection");
	});

	it("rejects a synthetic skill catalog in host-native mode", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-native-skill-"));
		await expect(
			loadContext({ cwd: dir, mode: "host-native", skills: [".agents/skills/probe"] }),
		).rejects.toThrow("does not allow a synthetic skills catalog");
	});

	it("leaves workspace discovery to the host in host-native mode", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-harness-native-disk-"));
		await writeFile(join(dir, "AGENTS.md"), "native only", "utf8");
		const context = await loadContext({ cwd: dir, mode: "host-native" });
		expect(context).toMatchObject({ mode: "host-native", sources: [], preamble: "" });
	});
});
