import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	CURSOR_USER_HOME_DIR_PREFIX,
	claudeSessionFlags,
	countUserSkillEntries,
	createCursorUserHome,
	cursorSettingSources,
	openaiUserConfigArgs,
	resolveIncludeGlobalSkills,
	withCursorUserHome,
} from "../user-skills.js";

async function plantUserSkills(homeDir: string, names: string[]): Promise<void> {
	for (const name of names) {
		const dir = join(homeDir, ".agents/skills", name);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
	}
}

describe("user skills isolation", () => {
	it("denies host-global user skills when the field is omitted", () => {
		expect(resolveIncludeGlobalSkills(undefined, undefined)).toBe(false);
		expect(resolveIncludeGlobalSkills(undefined, false)).toBe(false);
	});

	it("lets the scenario value win over suite defaults", () => {
		expect(resolveIncludeGlobalSkills(true, false)).toBe(true);
		expect(resolveIncludeGlobalSkills(false, true)).toBe(false);
	});

	it("keeps Cursor on project settings unless the run allows user skills", () => {
		expect(cursorSettingSources(false)).toEqual(["project"]);
		expect(cursorSettingSources(true)).toEqual(["project", "user"]);
	});

	it("keeps Claude subscription on project settings unless the run allows user skills", () => {
		expect(claudeSessionFlags("subscription", false)).toEqual([
			"--strict-mcp-config",
			"--setting-sources",
			"project",
		]);
		expect(claudeSessionFlags("subscription", true)).toEqual([
			"--strict-mcp-config",
			"--setting-sources",
			"user,project",
		]);
	});

	it("keeps Claude api-key on --bare when user skills stay out", () => {
		expect(claudeSessionFlags("api-key", false)).toEqual(["--bare"]);
		expect(claudeSessionFlags("api-key", true)).toEqual([
			"--strict-mcp-config",
			"--setting-sources",
			"user,project",
		]);
	});

	it("lets Claude api-key discover project context in host-native mode", () => {
		expect(claudeSessionFlags("api-key", false, true)).toEqual([
			"--strict-mcp-config",
			"--setting-sources",
			"project",
		]);
	});

	it("keeps Codex on --ignore-user-config unless the run allows user skills", () => {
		expect(openaiUserConfigArgs(false)).toEqual(["--ignore-user-config"]);
		expect(openaiUserConfigArgs(true)).toEqual([]);
	});

	it("counts zero user-skill injection when includeGlobalSkills is false", async () => {
		const realHome = await mkdtemp(join(tmpdir(), "user-skills-real-"));
		try {
			await plantUserSkills(realHome, ["alpha", "beta", "gamma"]);
			expect(await countUserSkillEntries(realHome)).toBe(3);
			const isolated = await createCursorUserHome(false, { realHome });
			try {
				expect(isolated.home).not.toBe(realHome);
				expect(isolated.home).toContain(CURSOR_USER_HOME_DIR_PREFIX);
				expect(await countUserSkillEntries(isolated.home)).toBe(0);
			} finally {
				await isolated.cleanup();
			}
		} finally {
			await rm(realHome, { recursive: true, force: true });
		}
	});

	it("keeps user-skill injection when includeGlobalSkills is true", async () => {
		const realHome = await mkdtemp(join(tmpdir(), "user-skills-allow-"));
		try {
			await plantUserSkills(realHome, ["kept-a", "kept-b"]);
			const allowed = await createCursorUserHome(true, { realHome });
			expect(allowed.home).toBe(realHome);
			expect(await countUserSkillEntries(allowed.home)).toBe(2);
		} finally {
			await rm(realHome, { recursive: true, force: true });
		}
	});
});

describe("withCursorUserHome", () => {
	const priorHome = process.env.HOME;
	const priorProfile = process.env.USERPROFILE;

	afterEach(() => {
		if (priorHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = priorHome;
		}
		if (priorProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = priorProfile;
		}
	});

	it("points HOME at a skill-empty tree when user skills stay out", async () => {
		let homeDuringRun: string | undefined;
		await withCursorUserHome(false, async () => {
			homeDuringRun = process.env.HOME;
			expect(homeDuringRun).toBeDefined();
			expect(homeDuringRun).toContain(CURSOR_USER_HOME_DIR_PREFIX);
			expect(await countUserSkillEntries(homeDuringRun ?? "")).toBe(0);
		});
		expect(process.env.HOME).toBe(priorHome);
	});

	it("leaves HOME unchanged when user skills are allowed", async () => {
		await withCursorUserHome(true, async () => {
			expect(process.env.HOME).toBe(priorHome);
		});
	});
});
