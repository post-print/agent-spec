import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Project skill trees used by Cursor, Claude, Codex, and similar hosts. */
export const SKILL_ROOTS = [
	".agents/skills",
	".cursor/skills",
	".codex/skills",
	".claude/skills",
] as const;

const SKILL_WORKFLOW_PATH_PATTERN =
	/(?:^|[/\\])(?:\.agents|\.cursor|\.codex|\.claude)[/\\]skills[/\\]([^/\\]+)[/\\](?:SKILL\.md|references[/\\])/i;

const INTERNAL_SKILL_NAMES = new Set(["align-commands"]);
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Skill folder name from a host-agnostic SKILL.md or references path. */
export function skillNameFromWorkflowPath(path: string): string | undefined {
	const match = path.match(SKILL_WORKFLOW_PATH_PATTERN);
	return match?.[1]?.toLowerCase();
}

export type SkillContextMode = "none" | "catalog" | "full";

export type SkillContextOptions =
	| { mode: "none"; include?: readonly string[] }
	| { mode?: "catalog" | "full"; include: readonly string[] };

/** Skill files for one run. Use repo-relative SKILL.md or skill-folder paths. */
export type SkillContextSetting = "none" | readonly string[] | SkillContextOptions;

export interface SkillCatalogEntry {
	name: string;
	dir: string;
	relPath: string;
	description: string;
	disableModelInvocation: boolean;
}

function parseFrontmatter(raw: string): Record<string, string> {
	const match = FRONTMATTER_PATTERN.exec(raw);
	if (!match?.[1]) {
		return {};
	}
	const fields: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon === -1) {
			continue;
		}
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (key) {
			fields[key] = value;
		}
	}
	return fields;
}

export function normalizeRelSkillPath(raw: string): string {
	return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
}

/** True for a repo-relative skill file or folder. Bare names are invalid. */
export function isRepoRelativeSkillPath(raw: string): boolean {
	const rel = normalizeRelSkillPath(raw);
	if (!rel || isAbsolute(raw) || rel.startsWith("/")) {
		return false;
	}
	if (rel.split("/").includes("..") || rel.split("/").includes(".")) {
		return false;
	}
	return rel.includes("/");
}

/** SKILL.md path for a listed skill file or folder. */
export function skillManifestRelPath(raw: string): string {
	const rel = normalizeRelSkillPath(raw);
	if (/\/skill\.md$/i.test(rel)) {
		return rel.replace(/skill\.md$/i, "SKILL.md");
	}
	return `${rel}/SKILL.md`;
}

/** Folder copied into the sealed workspace for a listed skill path. */
export function skillOverlayRelPath(raw: string): string {
	const manifest = skillManifestRelPath(raw);
	const slash = manifest.lastIndexOf("/");
	return slash === -1 ? manifest : manifest.slice(0, slash);
}

function normalizePaths(paths: readonly string[] | undefined): string[] {
	const include = (paths ?? []).map((item) => normalizeRelSkillPath(item)).filter(Boolean);
	const invalid = include.filter((item) => !isRepoRelativeSkillPath(item));
	if (invalid.length > 0) {
		throw new Error(
			`skills must be repo-relative paths (for example [".agents/skills/skeleton/SKILL.md"]), got ${JSON.stringify(invalid)}`,
		);
	}
	return include;
}

/** Skill paths this run may load. Empty when skills are off. */
export function skillPathsFromSetting(setting: SkillContextSetting | undefined): string[] {
	return normalizeSkillContext(setting).include ?? [];
}

function normalizeSkillContext(setting: SkillContextSetting | undefined): {
	mode: SkillContextMode;
	include: string[];
} {
	if (!setting || setting === "none") {
		return { mode: "none", include: [] };
	}
	if (Array.isArray(setting)) {
		const include = normalizePaths(setting);
		return { mode: include.length > 0 ? "catalog" : "none", include };
	}
	if (typeof setting === "string") {
		throw new Error(
			`skills "${setting}" is invalid — pass a list of skill paths (for example [".agents/skills/skeleton/SKILL.md"])`,
		);
	}
	const options = setting as SkillContextOptions;
	const include = normalizePaths(options.include);
	const mode = options.mode ?? (include.length > 0 ? "catalog" : "none");
	if (mode !== "none" && include.length === 0) {
		throw new Error("skills.include must list the skill paths for this run");
	}
	return { mode: mode === "none" ? "none" : mode, include };
}

async function resolveSkillPath(cwd: string, raw: string): Promise<SkillCatalogEntry | undefined> {
	const relPath = skillManifestRelPath(raw);
	const dir = skillOverlayRelPath(raw).split("/").pop() ?? relPath;
	const absPath = join(cwd, relPath);
	let rawText: string;
	try {
		rawText = await readFile(absPath, "utf8");
	} catch {
		return undefined;
	}
	const frontmatter = parseFrontmatter(rawText);
	const name = frontmatter.name ?? dir;
	if (INTERNAL_SKILL_NAMES.has(name) || INTERNAL_SKILL_NAMES.has(dir)) {
		return undefined;
	}
	return {
		name,
		dir,
		relPath,
		description: frontmatter.description ?? "",
		disableModelInvocation: frontmatter["disable-model-invocation"] === "true",
	};
}

async function resolveSkillPaths(cwd: string, include: string[]): Promise<SkillCatalogEntry[]> {
	const skills: SkillCatalogEntry[] = [];
	const seen = new Set<string>();
	const missing: string[] = [];
	for (const raw of include) {
		const key = skillManifestRelPath(raw).toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		const skill = await resolveSkillPath(cwd, raw);
		if (!skill) {
			missing.push(raw);
			continue;
		}
		seen.add(key);
		skills.push(skill);
	}
	if (missing.length > 0) {
		throw new Error(`skill not found: ${missing.join(", ")}`);
	}
	return skills;
}

function buildCatalogSection(skills: SkillCatalogEntry[]): string {
	const lines = [
		"## Skill catalog (available skills — read SKILL.md before following a skill)",
		"",
		"| Skill | Path | Invocation | Description |",
		"|-------|------|------------|-------------|",
	];
	for (const skill of skills) {
		const invocation = skill.disableModelInvocation ? "user-invoked" : "model-invoked";
		const description = skill.description.replace(/\|/g, "\\|");
		lines.push(`| ${skill.name} | \`${skill.relPath}\` | ${invocation} | ${description} |`);
	}
	return lines.join("\n");
}

export interface LoadedSkillContext {
	mode: SkillContextMode;
	sources: string[];
	preamble: string;
	catalog: SkillCatalogEntry[];
}

/** Load skill catalog index and/or full SKILL.md bodies for agent preamble. */
export async function loadSkillContext(
	cwd: string,
	setting: SkillContextSetting | undefined,
): Promise<LoadedSkillContext> {
	const options = normalizeSkillContext(setting);
	if (options.mode === "none") {
		return { mode: "none", sources: [], preamble: "", catalog: [] };
	}

	const skills = await resolveSkillPaths(cwd, options.include ?? []);
	const sources: string[] = [];
	const parts: string[] = [];

	if (options.mode === "catalog" || options.mode === "full") {
		parts.push(buildCatalogSection(skills));
		sources.push("skills/catalog");
	}

	if (options.mode === "full") {
		for (const skill of skills) {
			const absPath = join(cwd, skill.relPath);
			const body = await readFile(absPath, "utf8");
			sources.push(skill.relPath);
			parts.push(`<!-- ${skill.relPath} -->\n${body}`);
		}
	}

	return {
		mode: options.mode,
		sources,
		preamble: parts.join("\n\n---\n\n"),
		catalog: skills,
	};
}

export { normalizeSkillContext };
