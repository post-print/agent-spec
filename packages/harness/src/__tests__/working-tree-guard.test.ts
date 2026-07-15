import { describe, expect, it } from "vitest";

import { findWorkingTreeLeak } from "../working-tree-guard";

describe("findWorkingTreeLeak", () => {
	it("returns no lines when status is unchanged", () => {
		const snapshot = " M apps/client/src/foo.ts";
		expect(findWorkingTreeLeak(snapshot, snapshot)).toEqual([]);
	});

	it("detects new dirty paths in caller tree", () => {
		const before = "";
		const after = " M apps/client/src/utils/post-login-redirect.ts";
		expect(findWorkingTreeLeak(before, after)).toEqual([after]);
	});

	it("ignores lines that existed before the scenario", () => {
		const before = " M package.json\n?? agent-suites/tmp";
		const after = " M package.json\n?? agent-suites/tmp\n M apps/client/src/foo.ts";
		expect(findWorkingTreeLeak(before, after)).toEqual([" M apps/client/src/foo.ts"]);
	});
});
