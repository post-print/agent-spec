import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSkillContext, type SkillContextSetting } from "./skills-context";
import type { ContextProfile, LoadedContext } from "./types";

const SHARED_SOURCES = ["AGENTS.md", ".claude/skills/README.md"] as const;

const CLAUDE_SOURCES = ["CLAUDE.md", "AGENTS.md"] as const;

const CURSOR_RULES_DIR = ".cursor/rules";

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readIfExists(cwd: string, rel: string): Promise<string | null> {
	const path = join(cwd, rel);
	if (!(await fileExists(path))) {
		return null;
	}
	return readFile(path, "utf8");
}

async function loadCursorRules(cwd: string): Promise<Array<{ rel: string; text: string }>> {
	const rulesDir = join(cwd, CURSOR_RULES_DIR);
	if (!(await fileExists(rulesDir))) {
		return [];
	}
	const entries = (await readdir(rulesDir)).filter((name) => name.endsWith(".mdc")).sort();
	const loaded: Array<{ rel: string; text: string }> = [];
	for (const name of entries) {
		const rel = `${CURSOR_RULES_DIR}/${name}`;
		const text = await readIfExists(cwd, rel);
		if (text !== null) {
			loaded.push({ rel, text });
		}
	}
	return loaded;
}

function sourcesForProfile(profile: ContextProfile): readonly string[] {
	switch (profile) {
		case "claude":
			return [...SHARED_SOURCES, ...CLAUDE_SOURCES];
		default:
			return SHARED_SOURCES;
	}
}

export interface LoadContextOptions {
	cwd: string;
	profile?: ContextProfile;
	/** none | catalog (index) | full (catalog + all SKILL.md bodies). */
	skills?: SkillContextSetting;
}

/** Load canonical agent context files from the repo. */
export async function loadContext(options: LoadContextOptions): Promise<LoadedContext> {
	const profile = options.profile ?? "shared";
	const seen = new Set<string>();
	const parts: string[] = [];
	const loaded: string[] = [];

	for (const rel of sourcesForProfile(profile)) {
		if (seen.has(rel)) {
			continue;
		}
		seen.add(rel);
		const text = await readIfExists(options.cwd, rel);
		if (text === null) {
			continue;
		}
		loaded.push(rel);
		parts.push(`<!-- ${rel} -->\n${text}`);
	}

	if (profile === "cursor") {
		for (const rule of await loadCursorRules(options.cwd)) {
			if (seen.has(rule.rel)) {
				continue;
			}
			seen.add(rule.rel);
			loaded.push(rule.rel);
			parts.push(`<!-- ${rule.rel} -->\n${rule.text}`);
		}
	}

	const skillContext = await loadSkillContext(options.cwd, options.skills);
	if (skillContext.preamble) {
		for (const rel of skillContext.sources) {
			if (!seen.has(rel)) {
				seen.add(rel);
				loaded.push(rel);
			}
		}
		parts.push(skillContext.preamble);
	}

	return {
		profile,
		cwd: options.cwd,
		sources: loaded,
		preamble: parts.join("\n\n---\n\n"),
		skillsMode: skillContext.mode,
	};
}
