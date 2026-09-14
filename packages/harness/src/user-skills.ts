import { access, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Cursor on-disk layers that can feed skills and settings. */
export type CursorSettingSource = "project" | "user" | "plugins";

/**
 * Host trees Cursor `AgentSkillsCursorRulesService` always indexes from
 * `os.homedir()`, even when `settingSources` omits `user`.
 */
export const CURSOR_USER_SKILL_ROOTS = [
	".cursor/skills-cursor",
	".cursor/skills",
	".agents/skills",
	".claude/skills",
	".codex/skills",
] as const;

export const CURSOR_USER_HOME_DIR_PREFIX = "agent-harness-cursor-home-";

/** Absolute skill-root paths Cursor indexes under a home directory. */
export function cursorUserSkillRoots(homeDir: string): string[] {
	return CURSOR_USER_SKILL_ROOTS.map((rel) => join(homeDir, rel));
}

/** Count SKILL.md folders under Cursor user-skill roots for one home. */
export async function countUserSkillEntries(homeDir: string): Promise<number> {
	let total = 0;
	for (const root of cursorUserSkillRoots(homeDir)) {
		try {
			const entries = await readdir(root, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}
				try {
					await access(join(root, entry.name, "SKILL.md"));
					total += 1;
				} catch {
					// Folder without a skill manifest does not count.
				}
			}
		} catch {
			// Missing skill root does not count.
		}
	}
	return total;
}

export interface CursorUserHome {
	home: string;
	cleanup: () => Promise<void>;
}

/**
 * Home directory Cursor `os.homedir()` will see.
 * Deny uses a temp tree with no user-skill roots.
 */
export async function createCursorUserHome(
	allowUserSkills: boolean,
	options?: { realHome?: string },
): Promise<CursorUserHome> {
	const realHome = options?.realHome ?? homedir();
	if (allowUserSkills) {
		return { home: realHome, cleanup: async () => {} };
	}
	const home = await mkdtemp(join(tmpdir(), CURSOR_USER_HOME_DIR_PREFIX));
	await copyCursorSdkAuth(realHome, home);
	return {
		home,
		cleanup: async () => {
			await rm(home, { recursive: true, force: true });
		},
	};
}

async function copyCursorSdkAuth(realHome: string, isolatedHome: string): Promise<void> {
	const src = join(realHome, ".cursor", "sdk");
	try {
		await access(src);
	} catch {
		return;
	}
	await mkdir(join(isolatedHome, ".cursor"), { recursive: true });
	await cp(src, join(isolatedHome, ".cursor", "sdk"), { recursive: true });
}

/**
 * Point `HOME` / `USERPROFILE` at an empty user-skill tree for one Node run.
 * Bun `os.homedir()` ignores `HOME`. Live `agent-test` runs under Node.
 */
export async function withCursorUserHome<T>(
	allowUserSkills: boolean,
	run: () => Promise<T>,
): Promise<T> {
	if (allowUserSkills) {
		return await run();
	}
	const isolated = await createCursorUserHome(false);
	const priorHome = process.env.HOME;
	const priorProfile = process.env.USERPROFILE;
	process.env.HOME = isolated.home;
	process.env.USERPROFILE = isolated.home;
	try {
		return await run();
	} finally {
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
		await isolated.cleanup();
	}
}

/**
 * Host-global user skills stay out unless the caller sets true.
 * Scenario value wins over suite defaults. Omitted values are false.
 */
export function resolveAllowUserSkills(scenarioValue?: boolean, defaultValue?: boolean): boolean {
	if (scenarioValue !== undefined) {
		return scenarioValue === true;
	}
	return defaultValue === true;
}

/**
 * Cursor SDK `local.settingSources`. Deny keeps project files only.
 * The skill service still scans `os.homedir()`, so deny also uses a temp HOME.
 */
export function cursorSettingSources(allowUserSkills: boolean): CursorSettingSource[] {
	return allowUserSkills ? ["project", "user"] : ["project"];
}

/**
 * Claude CLI isolation flags after `-p`.
 * Deny + api-key keeps `--bare`. Deny + subscription loads project only.
 */
export function claudeSessionFlags(
	authMode: "api-key" | "subscription",
	allowUserSkills: boolean,
): string[] {
	if (allowUserSkills) {
		return ["--strict-mcp-config", "--setting-sources", "user,project"];
	}
	if (authMode === "api-key") {
		return ["--bare"];
	}
	return ["--strict-mcp-config", "--setting-sources", "project"];
}

/** Codex `--ignore-user-config` when user skills stay out. */
export function openaiUserConfigArgs(allowUserSkills: boolean): string[] {
	return allowUserSkills ? [] : ["--ignore-user-config"];
}
