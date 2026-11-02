import { describe, expect, it } from "bun:test";
import { hostConditions } from "../host-conditions.js";
import { claudeSessionFlags } from "../user-skills.js";

const claude = (options: object) => ({ host: "claude" as const, options });
const API_KEY = { type: "api-key" as const, env: "KEY" };

describe("host conditions", () => {
	it("states the setting sources the Claude flags actually load", async () => {
		const bare = claude({ auth: API_KEY, loadProjectContext: false });
		expect(claudeSessionFlags("api-key", false, false)).toEqual(["--bare"]);
		expect((await hostConditions(bare, false)).settingSources).toEqual([]);
		const project = claude({ auth: API_KEY });
		expect((await hostConditions(project, false)).settingSources).toEqual(["project"]);
		const subscription = claude({ loadProjectContext: false });
		expect((await hostConditions(subscription, false)).settingSources).toEqual(["project"]);
		const global = claude({ auth: API_KEY, includeGlobalSkills: true, loadProjectContext: false });
		expect((await hostConditions(global, false)).settingSources).toEqual(["user", "project"]);
	});
	it("states that user configuration stays out unless a user setting source loads", async () => {
		const userConfig = async (options: object) =>
			(await hostConditions(claude(options), false)).userConfig;
		expect(claudeSessionFlags("subscription", false, true)).toEqual([
			"--strict-mcp-config",
			"--setting-sources",
			"project",
		]);
		expect(await userConfig({})).toBe("excluded");
		expect(await userConfig({ auth: API_KEY, loadProjectContext: false })).toBe("excluded");
		expect(await userConfig({ includeGlobalSkills: true })).toBe("may-load");
		const openai = (options: object) => ({ host: "openai" as const, options });
		expect((await hostConditions(openai({}), false)).userConfig).toBe("excluded");
		expect((await hostConditions(openai({ includeGlobalSkills: true }), false)).userConfig).toBe(
			"may-load",
		);
		expect((await hostConditions({ options: {} }, false)).userConfig).toBe("unknown");
	});
	it("records an unconfined Claude agent as detect-only, with its allow list", async () => {
		const unconfined = claude({ confinement: "none", allowedTools: ["Read", "Bash(ls)"] });
		const agent = await hostConditions(unconfined, false);
		expect(agent).toMatchObject({
			confinement: "detect-only",
			network: "enabled",
			allowedTools: ["Read", "Bash(ls)"],
		});
		expect(await hostConditions(unconfined, true)).toMatchObject({
			confinement: "host-enforced",
			network: "disabled",
		});
		expect((await hostConditions(claude({}), false)).confinement).toBe("host-enforced");
		expect((await hostConditions(claude({}), false)).allowedTools).toEqual([]);
		expect((await hostConditions({ options: {} }, false)).confinement).toBe("detect-only");
	});
});
