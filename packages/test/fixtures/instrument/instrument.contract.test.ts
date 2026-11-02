import { afterAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRecordedExecution } from "../../dist/sdk/execution-runner.js";
import { executionHistoryRoot, readExecutionDetail } from "../../dist/sdk/execution-store.js";

const config = fileURLToPath(new URL("./agent-test.config.ts", import.meta.url));
const fakeHost = fileURLToPath(new URL("./fake-host.mjs", import.meta.url));
const roots: string[] = [];

async function runScenario(grep: string, extra: string[] = []) {
	const previous = process.env.CLAUDE_CODE_BIN;
	process.env.CLAUDE_CODE_BIN = fakeHost;
	const execution = await startRecordedExecution({
		config,
		args: ["--grep", grep, "--workers", "1", ...extra],
	});
	if (previous === undefined) delete process.env.CLAUDE_CODE_BIN;
	else process.env.CLAUDE_CODE_BIN = previous;
	const root = join(executionHistoryRoot(config), execution.id);
	roots.push(root);
	const exitCode = await execution.completed;
	return { exitCode, verdict: await execution.verdict, summary: await readExecutionDetail(root) };
}
afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const rate = (title: string) => runScenario(`instrument rates ${title} \\[`);

describe("judges through the real runner", () => {
	it("takes the verdict from the host's enforced output, not its prose", async () => {
		const { verdict, exitCode } = await runScenario("judge verdict comes from enforced output");
		expect(verdict.verdict).toBe("passed");
		expect(exitCode).toBe(0);
	}, 60_000);
	for (const title of [
		"judge answers with the schema",
		"judge answers in prose",
		"judge host reports a failure",
		"judge cannot start",
	])
		it(`${title}: no verdict, not an agent failure`, async () => {
			const { verdict, exitCode } = await runScenario(title);
			expect(verdict.verdict).toBe("infra_invalid");
			expect(exitCode).toBe(2);
		}, 60_000);
	for (const title of [
		"judge rejects the answer$",
		"judge rejects the answer while another judge is running",
	])
		it(`${title}: still a failure`, async () => {
			const { verdict, exitCode } = await runScenario(title);
			expect(verdict.verdict).toBe("agent_failed");
			expect(exitCode).toBe(1);
		}, 60_000);
});
describe("rates through the real runner", () => {
	it("samples: 5 produces one claim with its count and interval", async () => {
		const { verdict, exitCode } = await rate("sampled pass");
		expect(verdict.verdict).toBe("measured");
		expect(exitCode).toBe(0);
		expect(verdict.claims).toHaveLength(1);
		const arm = verdict.claims[0]?.arms[0];
		expect(arm).toMatchObject({ passed: 5, failed: 0, total: 5 });
		expect(arm?.interval.low).toBeCloseTo(0.478, 2);
	}, 60_000);
	it("a failed sample is part of a rate, not a failed run", async () => {
		const { verdict, exitCode } = await rate("sampled with a failure");
		expect(verdict.verdict).toBe("measured");
		expect(exitCode).toBe(0);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ passed: 2, failed: 1, total: 3 });
	}, 60_000);
});
describe("sampling plans through the real runner", () => {
	it("a plan stops once it flags, and spends no more runs", async () => {
		const { verdict, exitCode } = await rate("plan flags early");
		expect(verdict.verdict).toBe("agent_failed");
		expect(exitCode).toBe(1);
		expect(verdict.claims[0]).toMatchObject({ decision: "flagged", flagAt: 2 });
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ failed: 2, total: 2 });
	}, 60_000);
});
describe("plans and repeats short of verdicts through the real runner", () => {
	it("a plan short of verdicts runs every sample and does not clear", async () => {
		const { verdict, exitCode } = await rate("plan short of verdicts");
		expect(verdict.verdict).toBe("infra_invalid");
		expect(exitCode).toBe(2);
		expect(verdict.claims[0]).toMatchObject({ decision: "no_verdict", flagAt: 2 });
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ passed: 2, failed: 0, noVerdict: 2 });
	}, 120_000);
	it("a plan of controls that fail as they must clears", async () => {
		const { verdict, exitCode } = await rate("plan of controls");
		expect(verdict.verdict).toBe("passed");
		expect(exitCode).toBe(0);
		expect(verdict.claims[0]).toMatchObject({ decision: "clear", flagAt: 2 });
	}, 120_000);
	it("a handled judge failure does not bring a plan's stop closer", async () => {
		const { verdict, exitCode } = await rate("plan with handled judge failures");
		expect(exitCode).toBe(2);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ failed: 0, noVerdict: 4 });
	}, 120_000);
	it("a soft failure brings a plan's stop closer", async () => {
		const { verdict, exitCode } = await rate("plan with soft failures");
		expect(exitCode).toBe(1);
		expect(verdict.claims[0]).toMatchObject({ decision: "flagged" });
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ failed: 2 });
	}, 120_000);
	it("a repeat with no verdict keeps a gate from going green", async () => {
		const { verdict, exitCode } = await runScenario("repeat short of verdicts", [
			"--repeat-each",
			"2",
		]);
		expect(verdict.verdict).toBe("infra_invalid");
		expect(exitCode).toBe(2);
	}, 120_000);
	it("a plan stops once the flag cannot be reached", async () => {
		const { verdict, exitCode } = await rate("plan clears early");
		expect(verdict.verdict).toBe("passed");
		expect(exitCode).toBe(0);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ passed: 4, total: 4 });
	}, 60_000);
	it("infrastructure failures do not count as samples", async () => {
		const { verdict, exitCode } = await rate("infrastructure is not a sample");
		expect(verdict.verdict).toBe("infra_invalid");
		expect(exitCode).toBe(2);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ total: 0, noVerdict: 2 });
	}, 60_000);
});
describe("comparisons through the real runner", () => {
	it("two arms report both rates and their difference", async () => {
		const { verdict } = await rate("two arms differ");
		const [claim] = verdict.claims;
		expect(claim?.arms.map(({ variant, passed }) => [variant, passed]).sort()).toEqual([
			["bad", 0],
			["good", 5],
		]);
		expect(claim?.comparison?.distinguishable).toBe(true);
	}, 90_000);
	it("arms that differ beyond the declared subject are refused", async () => {
		const { verdict, exitCode } = await rate("arms differ beyond the subject");
		expect(verdict.claims[0]?.comparisonRefused).toContain("hashes.prompt");
		expect(verdict.verdict).toBe("conditions_unknown");
		expect(exitCode).toBe(2);
	}, 60_000);
});

const SCENARIOS: [title: string, verdict: string, exitCode: number][] = [
	["good run", "passed", 0],
	["assertion fails", "agent_failed", 1],
	["host reports hitting its limit", "agent_failed", 1],
	["host emits nothing", "infra_invalid", 2],
	["host emits garbage", "infra_invalid", 2],
	["host is killed", "infra_invalid", 2],
	["host is not logged in", "infra_invalid", 2],
	["negative assertion on an empty run", "infra_invalid", 2],
	["test never runs an agent", "vacuous", 2],
	["unawaited run fails", "vacuous", 2],
	["catalog is unknown", "conditions_unknown", 2],
	["skipped", "skipped_only", 2],
	["control survives", "control_survived", 1],
	["control breaks in its own code", "vacuous", 2],
	["control fails before the agent runs", "vacuous", 2],
	["check fails before the agent runs", "vacuous", 2],
	["worker process crashes", "infra_invalid", 2],
	["failed check quotes the agent saying Test timeout of 100ms exceeded.", "agent_failed", 1],
	["failed check quotes the agent saying Agent worker exited", "agent_failed", 1],
	["failed check quotes the agent saying Agent session cancelled", "agent_failed", 1],
	["failed check quotes the agent saying AgentInfrastructureError: auth", "agent_failed", 1],
	["failed check quotes the agent saying ConditionsUnknownError: no catalog", "agent_failed", 1],
	[
		"failed check quotes the agent saying The test finished without a completed agent operation",
		"agent_failed",
		1,
	],
];
describe("the verdict for a scripted host through the real runner", () => {
	for (const [title, verdict, exitCode] of SCENARIOS) {
		it(`${title}: ${verdict}, exit ${exitCode}`, async () => {
			const result = await runScenario(`instrument ${title}$`);
			expect(result.verdict.verdict).toBe(verdict as never);
			expect(result.exitCode).toBe(exitCode);
			expect(result.summary?.verdict?.verdict).toBe(verdict as never);
		}, 60_000);
	}
	it("a pass after a retry is flaky, not passed", async () => {
		const result = await runScenario("instrument passes on retry$", ["--retries", "1"]);
		expect(result.verdict.verdict).toBe("flaky");
		expect(result.exitCode).toBe(2);
	}, 60_000);
	it("no test matching is not a pass", async () => {
		const result = await runScenario("no test has this name");
		expect(result.verdict.verdict).toBe("skipped_only");
		expect(result.exitCode).toBe(2);
	}, 60_000);
	it("repeats of one test become one claim", async () => {
		const result = await runScenario("instrument good run$", ["--repeat-each", "3"]);
		expect(result.verdict.verdict).toBe("measured");
		expect(result.verdict.claims).toHaveLength(1);
		expect(result.verdict.claims[0]?.arms[0]).toMatchObject({ passed: 3, total: 3 });
	}, 60_000);
	it("a failed repeat still fails the run, so a gate stays a gate", async () => {
		const result = await runScenario("instrument assertion fails$", ["--repeat-each", "2"]);
		expect(result.verdict.verdict).toBe("agent_failed");
		expect(result.exitCode).toBe(1);
		expect(result.verdict.claims[0]?.arms[0]).toMatchObject({ failed: 2, total: 2 });
	}, 60_000);
	it("listing tests is not a run and does not fail", async () => {
		const result = await runScenario("good run$", ["--list"]);
		expect(result.verdict.verdict).toBe("listed");
		expect(result.exitCode).toBe(0);
	}, 60_000);
});
describe("results that have not been earned through the real runner", () => {
	it("a control that survives and then fails on retry is still a surviving control", async () => {
		const result = await runScenario("instrument control survives and fails on retry$", [
			"--retries",
			"1",
		]);
		expect(result.verdict.verdict).toBe("control_survived");
		expect(result.exitCode).toBe(1);
	}, 60_000);
	it("a surviving control fails a rate, which would otherwise only be measured", async () => {
		const { verdict, exitCode } = await rate("sampled control survives");
		expect(verdict.verdict).toBe("control_survived");
		expect(exitCode).toBe(1);
		expect(verdict.claims[0]?.controlsSurvived).toBe(2);
	}, 60_000);
	it("a surviving control fails a plan short of its flag", async () => {
		const { verdict, exitCode } = await rate("planned control survives");
		expect(verdict.verdict).toBe("control_survived");
		expect(exitCode).toBe(1);
	}, 60_000);
	it("tests stopped by --max-failures leave a rate with no verdict", async () => {
		const { verdict, exitCode } = await runScenario("instrument rates sampled and stopped \\[", [
			"--max-failures",
			"1",
		]);
		expect(verdict.notRun).toBeGreaterThan(0);
		expect(verdict.verdict).toBe("interrupted");
		expect(exitCode).toBe(2);
	}, 60_000);
	it("an arm filtered out of the run leaves no verdict", async () => {
		const { verdict, exitCode } = await runScenario("instrument rates two arms differ \\[good");
		expect(verdict.claims[0]?.decision).toBe("no_verdict");
		expect(verdict.claims[0]?.comparisonRefused).toContain("no run with a verdict");
		expect(exitCode).toBe(2);
	}, 60_000);
	it("an arm with no verdict is not compared", async () => {
		const { verdict, exitCode } = await rate("one arm has no verdict");
		expect(verdict.claims[0]?.comparison).toBeUndefined();
		expect(verdict.claims[0]?.comparisonRefused).toContain("arm b");
		expect(exitCode).toBe(2);
	}, 60_000);
	it("a retried sample counts once, at its first verdict", async () => {
		const { verdict } = await runScenario("instrument rates sample passes on retry \\[", [
			"--retries",
			"1",
		]);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ passed: 0, failed: 1, total: 1 });
	}, 60_000);
});
