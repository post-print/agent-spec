import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS_ROOT = ".claude/skills";
const INTERNAL_SKILL_NAMES = new Set(["align-commands"]);
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

export type SkillContextMode = "none" | "catalog" | "full";

export interface SkillContextOptions {
	mode: SkillContextMode;
	/** Full mode: load only these skill folder names. Omit = all public skills. */
	include?: string[];
}

export type SkillContextSetting = SkillContextMode | SkillContextOptions;

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

function normalizeSkillContext(setting: SkillContextSetting | undefined): SkillContextOptions {
	if (!setting) {
		return { mode: "none" };
	}
	if (typeof setting === "string") {
		return { mode: setting };
	}
	return setting;
}

async function discoverSkills(cwd: string): Promise<SkillCatalogEntry[]> {
	const skillsDir = join(cwd, SKILLS_ROOT);
	let entries: string[];
	try {
		entries = await readdir(skillsDir, { withFileTypes: true }).then((items) =>
			items.filter((item) => item.isDirectory()).map((item) => item.name),
		);
	} catch {
		return [];
	}

	const skills: SkillCatalogEntry[] = [];
	for (const dir of entries.sort()) {
		const relPath = `${SKILLS_ROOT}/${dir}/SKILL.md`;
		const absPath = join(cwd, relPath);
		let raw: string;
		try {
			raw = await readFile(absPath, "utf8");
		} catch {
			continue;
		}
		const frontmatter = parseFrontmatter(raw);
		const name = frontmatter.name ?? dir;
		if (INTERNAL_SKILL_NAMES.has(name) || INTERNAL_SKILL_NAMES.has(dir)) {
			continue;
		}
		skills.push({
			name,
			dir,
			relPath,
			description: frontmatter.description ?? "",
			disableModelInvocation: frontmatter["disable-model-invocation"] === "true",
		});
	}
	return skills;
}

function filterSkills(
	skills: SkillCatalogEntry[],
	include: string[] | undefined,
): SkillCatalogEntry[] {
	if (!include?.length) {
		return skills;
	}
	const wanted = new Set(include.map((name) => name.toLowerCase()));
	return skills.filter((skill) => wanted.has(skill.name.toLowerCase()) || wanted.has(skill.dir));
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

	const allSkills = await discoverSkills(cwd);
	const skills = filterSkills(allSkills, options.include);
	const sources: string[] = [];
	const parts: string[] = [];

	if (options.mode === "catalog" || options.mode === "full") {
		parts.push(buildCatalogSection(skills));
		sources.push(`${SKILLS_ROOT}/catalog`);
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
