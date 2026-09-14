import { describe, expect, it } from "bun:test";

import {
	claudeSessionFlags,
	cursorSettingSources,
	openaiUserConfigArgs,
	resolveAllowUserSkills,
} from "../user-skills.js";

describe("user skills isolation", () => {
	it("denies host-global user skills when the field is omitted", () => {
		expect(resolveAllowUserSkills(undefined, undefined)).toBe(false);
		expect(resolveAllowUserSkills(undefined, false)).toBe(false);
	});

	it("lets the scenario value win over suite defaults", () => {
		expect(resolveAllowUserSkills(true, false)).toBe(true);
		expect(resolveAllowUserSkills(false, true)).toBe(false);
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

	it("keeps Codex on --ignore-user-config unless the run allows user skills", () => {
		expect(openaiUserConfigArgs(false)).toEqual(["--ignore-user-config"]);
		expect(openaiUserConfigArgs(true)).toEqual([]);
	});
});
