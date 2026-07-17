import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSkillContext, type SkillContextSetting } from "./skills-context.js";
import type { ContextProfile, LoadedContext } from "./types.js";

const SHARED_SOURCES = ["AGENTS.md", ".claude/skills/README.md"] as const;

const CLAUDE_SOURCES = ["CLAUDE.md", "AGENTS.md"] as const;

const SKELETON_REGISTRY = ".skeleton/registry.md";
const SKELETON_CONFIG = ".skeleton/config.yaml";
const SKELETON_CUSTOMIZE_DIR = ".skeleton/customize";

const CURSOR_RULES_DIR = ".cursor/rules";

/** Max chars of config.yaml body kept in the preamble (header/summary, not plugin trees). */
const SKELETON_CONFIG_SUMMARY_MAX_CHARS = 2_500;

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
		case "skeleton":
			return [...SHARED_SOURCES, SKELETON_REGISTRY];
		default:
			return SHARED_SOURCES;
	}
}

/**
 * Lightweight parse of `customize.alwaysInclude` from `.skeleton/config.yaml`
 * without a YAML dependency. Paths are basenames under `.skeleton/customize/`.
 */
export function parseSkeletonAlwaysInclude(configText: string): string[] {
	const lines = configText.split(/\r?\n/);
	let inCustomize = false;
	let inAlwaysInclude = false;
	const items: string[] = [];

	for (const line of lines) {
		if (/^\s*#/.test(line) || line.trim() === "") {
			continue;
		}
		const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
		const trimmed = line.trim();

		if (indent === 0) {
			inCustomize = /^customize\s*:/.test(trimmed);
			inAlwaysInclude = false;
			continue;
		}

		if (!inCustomize) {
			continue;
		}

		if (indent <= 2 && /^alwaysInclude\s*:/.test(trimmed)) {
			inAlwaysInclude = true;
			continue;
		}

		if (indent <= 2 && !trimmed.startsWith("-")) {
			inAlwaysInclude = false;
			continue;
		}

		if (inAlwaysInclude && trimmed.startsWith("-")) {
			const value = trimmed
				.replace(/^-\s*/, "")
				.replace(/^["']|["']$/g, "")
				.trim();
			if (value.length > 0) {
				items.push(value);
			}
		}
	}

	return items;
}

/** Compact config summary for preamble — skips deep plugin trees / long lists. */
export function summarizeSkeletonConfig(configText: string): string {
	const kept: string[] = [];
	let chars = 0;
	for (const line of configText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#") && !trimmed.startsWith("# yaml-language-server")) {
			continue;
		}
		// Drop plugins / large nested blobs that are not useful as ambient context.
		if (/^\s*plugins\s*:/.test(line) || /^\s*-\s+\.skeleton\/plugins\//.test(line)) {
			continue;
		}
		const next = kept.length === 0 ? line : `${kept.join("\n")}\n${line}`;
		if (next.length > SKELETON_CONFIG_SUMMARY_MAX_CHARS) {
			kept.push("… (truncated)");
			break;
		}
		kept.push(line);
		chars = next.length;
		void chars;
	}
	return kept.join("\n").trim();
}

function resolveContextSourcePath(rel: string): string {
	const normalized = rel.replace(/^\.\//, "");
	if (
		normalized.startsWith(".skeleton/") ||
		normalized.startsWith("AGENTS.md") ||
		normalized.includes("/")
	) {
		return normalized;
	}
	return `${SKELETON_CUSTOMIZE_DIR}/${normalized}`;
}

export interface LoadContextOptions {
	cwd: string;
	profile?: ContextProfile;
	/** none | catalog (index) | full (catalog + all SKILL.md bodies). */
	skills?: SkillContextSetting;
	/**
	 * Additive repo-relative paths loaded after the profile sources.
	 * Bare basenames resolve under `.skeleton/customize/` (alwaysInclude style).
	 */
	contextSources?: string[];
}

/** Load canonical agent context files from the repo. */
export async function loadContext(options: LoadContextOptions): Promise<LoadedContext> {
	const profile = options.profile ?? "shared";
	const seen = new Set<string>();
	const parts: string[] = [];
	const loaded: string[] = [];

	const pushSource = async (rel: string, textOverride?: string): Promise<void> => {
		if (seen.has(rel)) {
			return;
		}
		const text = textOverride ?? (await readIfExists(options.cwd, rel));
		if (text === null) {
			return;
		}
		seen.add(rel);
		loaded.push(rel);
		parts.push(`<!-- ${rel} -->\n${text}`);
	};

	for (const rel of sourcesForProfile(profile)) {
		await pushSource(rel);
	}

	if (profile === "cursor") {
		for (const rule of await loadCursorRules(options.cwd)) {
			await pushSource(rule.rel, rule.text);
		}
	}

	if (profile === "skeleton") {
		const configText = await readIfExists(options.cwd, SKELETON_CONFIG);
		if (configText !== null) {
			const summary = summarizeSkeletonConfig(configText);
			await pushSource(SKELETON_CONFIG, summary.length > 0 ? summary : configText);
			for (const basename of parseSkeletonAlwaysInclude(configText)) {
				await pushSource(resolveContextSourcePath(basename));
			}
		}
	}

	for (const raw of options.contextSources ?? []) {
		if (typeof raw !== "string" || raw.trim().length === 0) {
			continue;
		}
		await pushSource(resolveContextSourcePath(raw.trim()));
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
