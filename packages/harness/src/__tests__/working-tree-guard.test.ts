import { describe, expect, it } from "vitest";

import {
	filterWorkingTreeLeaks,
	findWorkingTreeLeak,
	isPathUnderRoot,
	normalizePorcelainStatus,
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

describe("normalizePorcelainStatus", () => {
	it("keeps leading space on unstaged-only porcelain lines", () => {
		expect(normalizePorcelainStatus(" M agent-suites/fixtures/sample-app/src/auth.ts\n")).toBe(
			" M agent-suites/fixtures/sample-app/src/auth.ts",
		);
	});

	it("strips only surrounding newlines, not XY columns", () => {
		expect(normalizePorcelainStatus("\nM  staged.ts\n M unstaged.ts\n\n")).toBe(
			"M  staged.ts\n M unstaged.ts",
		);
	});
});

describe("porcelainPathFromStatusLine", () => {
	it("parses untracked directory lines", () => {
		expect(porcelainPathFromStatusLine("?? agent-test-debug/")).toBe("agent-test-debug/");
	});

	it("parses unstaged-only modification lines", () => {
		expect(porcelainPathFromStatusLine(" M agent-suites/fixtures/sample-app/src/auth.ts")).toBe(
			"agent-suites/fixtures/sample-app/src/auth.ts",
		);
	});

	it("does not recover paths from trim-corrupted porcelain (M␠path)", () => {
		// Regression: stdout.trim() turned " M path" into "M path" and slice(3) ate the path prefix.
		expect(porcelainPathFromStatusLine("M agent-suites/fixtures/sample-app/src/auth.ts")).toBe(
			"gent-suites/fixtures/sample-app/src/auth.ts",
		);
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
