import { expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../cli.js";
import { baselineDirectory } from "../sdk/baselines.js";
import { runBaselineCli, viewerHint } from "../sdk/cli.js";
import {
	ExecutionStore,
	executionHistoryRoot,
	saveExecutionVerdict,
} from "../sdk/execution-store.js";
import type { RunVerdict, VerdictResult } from "../sdk/verdict.js";

it("rejects legacy JSON flags with migration guidance", async () => {
	await expect(runCli(["--suites-dir", "agent-suites"])).rejects.toThrow("TypeScript suite");
});
it("rejects unknown commands instead of launching an agent", async () => {
	await expect(runCli(["unknown"])).rejects.toThrow("Unsupported command");
});
it("ends a run with the viewer command and asks an agent to check with the user first", () => {
	const executionId = "feed0000-0000-4000-8000-000000000001";
	const config = resolve("agent-suites/tour/agent-test.config.ts");
	const agent = viewerHint({ config, executionId, interactive: false, ci: false });
	expect(agent).toEqual([
		"View run feed0000: agent-test viewer --config agent-suites/tour/agent-test.config.ts",
		"Agent: ask the user whether to open the results viewer; start it only if they agree.",
	]);
	const person = viewerHint({
		config: resolve("agent-test.config.ts"),
		executionId,
		interactive: true,
		ci: false,
	});
	expect(person).toEqual(["View run feed0000: agent-test viewer"]);
	expect(viewerHint({ config, executionId, interactive: false, ci: true })).toEqual([]);
});

const standingClaim = (claim: string) => ({
	claim,
	declared: true,
	decision: "measured" as const,
	controlsSurvived: 0,
	fingerprint: "conditions",
	baseline: { status: "none" as const },
	arms: [
		{
			passed: 9,
			failed: 1,
			noVerdict: 0,
			total: 10,
			interval: { low: 0.55, high: 0.99 },
			lowerBound: 0.6,
		},
	],
});
async function storedRun(claimVerdicts: Record<string, RunVerdict>, verdict: RunVerdict) {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-baseline-"));
	const config = join(directory, "agent-test.config.ts");
	const root = join(executionHistoryRoot(config), "base-1");
	const store = await ExecutionStore.create({ root, id: "base-1", config });
	await store.finish("passed");
	await saveExecutionVerdict(root, {
		verdict,
		exitCode: 1,
		tests: {},
		counts: { passed: 0, total: 0 },
		claims: Object.keys(claimVerdicts).map(standingClaim),
		claimVerdicts,
	} as VerdictResult);
	return { directory, config };
}
it("a baseline is saved only from claims that stood, never from a failed one", async () => {
	const { directory, config } = await storedRun(
		{ "a › rate": "indicative", "a › regressed": "agent_failed" },
		"indicative",
	);
	try {
		await runBaselineCli(["--config", config]);
		expect(await readdir(baselineDirectory(config))).toHaveLength(1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("a run with no verdict saves no baseline at all", async () => {
	const { directory, config } = await storedRun({ "a › rate": "indicative" }, "infra_invalid");
	try {
		await runBaselineCli(["--config", config]);
		expect(await readdir(baselineDirectory(config)).catch(() => [])).toHaveLength(0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
