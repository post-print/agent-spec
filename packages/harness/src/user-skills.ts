/** Cursor on-disk layers that can feed skills and settings. */
export type CursorSettingSource = "project" | "user" | "plugins";

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

/** Cursor SDK `local.settingSources`. Deny keeps project files only. */
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
