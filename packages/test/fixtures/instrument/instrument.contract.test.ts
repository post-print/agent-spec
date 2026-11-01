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
