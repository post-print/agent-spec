import { describe, expect, it } from "vitest";
import type { AgentTrace } from "../types.js";
import {
	parseUnifiedDiffPaths,
	partitionSeedCollateralLeaks,
	traceEditsOutsideWorktree,
} from "../worktree-leak.js";

const REDIRECT_PATCH = `diff --git a/agent-suites/fixtures/sample-app/src/redirect.ts b/agent-suites/fixtures/sample-app/src/redirect.ts
--- a/agent-suites/fixtures/sample-app/src/redirect.ts
+++ b/agent-suites/fixtures/sample-app/src/redirect.ts
@@ -8,6 +8,7 @@ export function nextUrlAfterLogin(rawTarget: string | undefined): string {
+  // Staged seed: keep query strings on safe relative login redirects.
`;

describe("worktree-leak", () => {
	it("parses unified diff paths", () => {
		expect(parseUnifiedDiffPaths(REDIRECT_PATCH)).toEqual([
			"agent-suites/fixtures/sample-app/src/redirect.ts",
		]);
	});

	it("treats seed-target porcelain as collateral when agent did not edit outside worktree", () => {
		const leaked = ["M  agent-suites/fixtures/sample-app/src/redirect.ts"];
		const seedPaths = ["agent-suites/fixtures/sample-app/src/redirect.ts"];
		const { collateral, agentLeaks } = partitionSeedCollateralLeaks(leaked, seedPaths, []);
		expect(collateral).toEqual(leaked);
		expect(agentLeaks).toEqual([]);
	});

	it("treats unstaged seed-target porcelain as collateral (git apply / reset noise)", () => {
		const leaked = [" M agent-suites/fixtures/sample-app/src/auth.ts"];
		const seedPaths = ["agent-suites/fixtures/sample-app/src/auth.ts"];
		const { collateral, agentLeaks } = partitionSeedCollateralLeaks(leaked, seedPaths, []);
		expect(collateral).toEqual(leaked);
		expect(agentLeaks).toEqual([]);
	});

	it("flags real agent leaks on non-seed paths", () => {
		const leaked = [" M agent-suites/fixtures/sample-app/src/classify.ts"];
		const seedPaths = ["agent-suites/fixtures/sample-app/src/redirect.ts"];
		const { collateral, agentLeaks } = partitionSeedCollateralLeaks(leaked, seedPaths, []);
		expect(collateral).toEqual([]);
		expect(agentLeaks).toEqual(leaked);
	});

	it("flags seed-target paths when edit tools touched caller checkout", () => {
		const leaked = ["M  agent-suites/fixtures/sample-app/src/redirect.ts"];
		const seedPaths = ["agent-suites/fixtures/sample-app/src/redirect.ts"];
		const outsideEdits = ["agent-suites/fixtures/sample-app/src/redirect.ts"];
		const { collateral, agentLeaks } = partitionSeedCollateralLeaks(
			leaked,
			seedPaths,
			outsideEdits,
		);
		expect(collateral).toEqual([]);
		expect(agentLeaks).toEqual(leaked);
	});

	it("detects edit tool paths outside the worktree root", () => {
		const trace: AgentTrace = {
			messages: [],
			toolCalls: [
				{
					name: "StrReplace",
					args: {
						path: "agent-suites/fixtures/sample-app/src/classify.ts",
					},
				},
			],
			shellCommands: [],
			artifacts: {},
		};
		const outside = traceEditsOutsideWorktree(
			trace,
			"/tmp/agent-harness-wt-abc/wt",
			"/repo/toolbox",
		);
		expect(outside).toContain("agent-suites/fixtures/sample-app/src/classify.ts");
	});
});
