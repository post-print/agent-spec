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
	it("listing tests is not a run and does not fail", async () => {
		const result = await runScenario("good run$", ["--list"]);
		expect(result.verdict.verdict).toBe("listed");
		expect(result.exitCode).toBe(0);
	}, 60_000);
});
