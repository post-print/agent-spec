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
});
