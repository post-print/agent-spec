import { describe, expect, it } from "vitest";

import {
	filterWorkingTreeLeaks,
	findWorkingTreeLeak,
	isPathUnderRoot,
	porcelainPathFromStatusLine,
	resolveHarnessArtifactIgnoreRoots,
} from "../working-tree-guard.js";

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

describe("porcelainPathFromStatusLine", () => {
	it("parses untracked directory lines", () => {
		expect(porcelainPathFromStatusLine("?? agent-test-debug/")).toBe("agent-test-debug/");
	});

	it("parses rename targets", () => {
		expect(porcelainPathFromStatusLine('R  old.txt -> "new name.txt"')).toBe("new name.txt");
	});
});

describe("resolveHarnessArtifactIgnoreRoots", () => {
	it("returns in-repo debug dir roots only", () => {
		const repo = "/repo/toolbox";
		expect(resolveHarnessArtifactIgnoreRoots(repo, "/repo/toolbox/agent-test-debug")).toEqual([
			"/repo/toolbox/agent-test-debug",
		]);
		expect(resolveHarnessArtifactIgnoreRoots(repo, "/tmp/agent-spec")).toEqual([]);
	});
});

describe("filterWorkingTreeLeaks", () => {
	const repo = "/repo/toolbox";

	it("drops harness staging paths under an in-repo debug dir", () => {
		const leaked = ["?? agent-test-debug/", " M src/form.tsx"];
		const filtered = filterWorkingTreeLeaks(
			leaked,
			resolveHarnessArtifactIgnoreRoots(repo, `${repo}/agent-test-debug`),
			repo,
		);
		expect(filtered).toEqual([" M src/form.tsx"]);
	});

	it("keeps unrelated untracked paths", () => {
		const leaked = ["?? scratch.log"];
		const filtered = filterWorkingTreeLeaks(
			leaked,
			resolveHarnessArtifactIgnoreRoots(repo, `${repo}/agent-test-debug`),
			repo,
		);
		expect(filtered).toEqual(["?? scratch.log"]);
	});
});

describe("isPathUnderRoot", () => {
	it("matches nested paths", () => {
		expect(isPathUnderRoot("/repo/a/b/file.txt", "/repo/a")).toBe(true);
		expect(isPathUnderRoot("/repo/b/file.txt", "/repo/a")).toBe(false);
	});
});
