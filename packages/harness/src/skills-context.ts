/** Project skill trees preserved for host discovery or explicit preamble simulation. */
export const SKILL_ROOTS = [
	".agents/skills",
	".cursor/skills",
	".codex/skills",
	".claude/skills",
] as const;

const SKILL_WORKFLOW_PATH_PATTERN =
	/(?:^|[/\\])(?:\.agents|\.cursor|\.codex|\.claude)[/\\]skills[/\\]([^/\\]+)[/\\](?:SKILL\.md|references[/\\])/i;

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

export function normalizeRelSkillPath(raw: string): string {
	return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
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
