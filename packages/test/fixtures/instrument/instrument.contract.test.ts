import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "../../dist/index.js";
import { startRecordedExecution } from "../../dist/sdk/execution-runner.js";
import { executionHistoryRoot, readExecutionDetail } from "../../dist/sdk/execution-store.js";
import {
	ENFORCED_VECTORS,
	judgeKey,
	recordEscapeVector,
	recordHostCalibration,
	recordJudgeCalibration,
} from "../../dist/sdk/run-record.js";

const config = fileURLToPath(new URL("./agent-test.config.ts", import.meta.url));
const fakeHost = fileURLToPath(new URL("./fake-host.mjs", import.meta.url));
const roots: string[] = [];

type RunFlags = { allowIndicative?: boolean; verdictGrade?: boolean };
async function runScenario(grep: string, extra: string[] = [], flags: RunFlags = {}) {
	const previous = process.env.CLAUDE_CODE_BIN;
	process.env.CLAUDE_CODE_BIN = fakeHost;
	const execution = await startRecordedExecution({
		config,
		args: ["--grep", grep, "--workers", "1", ...extra],
		...flags,
	});
	if (previous === undefined) delete process.env.CLAUDE_CODE_BIN;
	else process.env.CLAUDE_CODE_BIN = previous;
	const root = join(executionHistoryRoot(config), execution.id);
	roots.push(root);
	const exitCode = await execution.completed;
	return { exitCode, verdict: await execution.verdict, summary: await readExecutionDetail(root) };
}
/** The fake host's probe: this version under API-key auth, so a run of it can carry a pass. */
const FAKE_HOST = { host: "claude", binaryVersion: "1", authMode: "api-key" };
const calibration = join(
	fileURLToPath(new URL(".", import.meta.url)),
	".agent-test",
	"calibration",
);
beforeAll(async () => {
	process.env.AGENT_TEST_FIXTURE_KEY = "fixture-key-not-real";
	await calibrateFakeHost();
});
/** The scripted host's probe and escape battery, both held, as a calibrated real host's would be. */
async function calibrateFakeHost() {
	const configDir = fileURLToPath(new URL(".", import.meta.url));
	await recordHostCalibration(configDir, FAKE_HOST);
	for (const vector of ENFORCED_VECTORS)
		await recordEscapeVector(configDir, FAKE_HOST, { vector, held: true });
	await recordJudgeCalibration(
		configDir,
		{ name: "reviewer", judge: { key: REVIEWER } },
		{
			fixtures: 0,
		},
	);
}
/** The scripted reviewer in instrument.spec.ts: its "no" counts against the agent once calibrated. */
const REVIEWER = judgeKey({
	prompt: "Is the input correct?",
	schema: z.toJSONSchema(z.object({ correct: z.boolean() })),
	host: "claude",
	model: "fake",
});
afterAll(async () => {
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const rate = (title: string) => runScenario(`instrument rates ${title} \\[`);

describe("judges through the real runner", () => {
	it("an uncalibrated judge's no is not charged to the agent", async () => {
		const { verdict, exitCode } = await runScenario("uncalibrated judge rejects the answer");
		expect(verdict.verdict).toBe("infra_invalid");
		expect(exitCode).toBe(2);
	}, 60_000);
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
	it("samples: 5 with no plan is one indicative claim with its count and interval", async () => {
		const { verdict, exitCode } = await rate("sampled pass");
		expect(verdict.verdict).toBe("indicative");
		expect(exitCode).toBe(3);
		expect(verdict.claims).toHaveLength(1);
		const arm = verdict.claims[0]?.arms[0];
		expect(arm).toMatchObject({ passed: 5, failed: 0, total: 5 });
		expect(arm?.interval.low).toBeCloseTo(0.478, 2);
	}, 60_000);
	it("a failed sample is part of a rate, not a failed run", async () => {
		const { verdict, exitCode } = await rate("sampled with a failure");
		expect(verdict.verdict).toBe("indicative");
		expect(exitCode).toBe(3);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ passed: 2, failed: 1, total: 3 });
	}, 60_000);
	it("--allow-indicative exits 0 on a rate and stores that it did", async () => {
		const { verdict, exitCode } = await runScenario("instrument rates sampled pass \\[", [], {
			allowIndicative: true,
		});
		expect(verdict).toMatchObject({ verdict: "indicative", indicativeAllowed: true });
		expect(exitCode).toBe(0);
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
	["test code breaks after the agent ran", "author_error", 2],
	["agent runs and nothing checks it", "vacuous", 2],
	["named control fails on the check it names", "passed", 0],
	["named control fails on a precondition instead", "vacuous", 2],
	["only the prompt is checked", "vacuous", 2],
	["a soft check on the run earns the pass", "passed", 0],
	["a check on the final workspace earns the pass", "passed", 0],
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
	["setup workspace is missing", "vacuous", 2],
	["later setup second run has a missing workspace", "vacuous", 2],
	["no-agent control fails on a check", "passed", 0],
	["agent leaves a read-only folder", "passed", 0],
	["control catches its own failed check, then throws", "vacuous", 2],
	["control fails softly before the agent runs", "vacuous", 2],
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
	it("repeats of one test become one claim, which passes only when every repeat did", async () => {
		const result = await runScenario("instrument good run$", ["--repeat-each", "3"]);
		expect(result.verdict.verdict).toBe("passed");
		expect(result.exitCode).toBe(0);
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
	it("a surviving control fails a rate, which would otherwise only be indicative", async () => {
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
describe("failures that say nothing about the agent, or say it plainly", () => {
	it("a rate in which no sample reached a host has no verdict", async () => {
		const { verdict, exitCode } = await runScenario(
			"instrument setup workspace is missing in a rate",
		);
		expect(verdict.claims[0]?.arms[0]).toMatchObject({ total: 0, noVerdict: 2 });
		expect(exitCode).toBe(2);
	}, 60_000);
	it("a sample's first failure stands although the runner calls it flaky", async () => {
		const { verdict, exitCode } = await runScenario(
			"instrument rates flagged plan passes on retry \\[",
			["--retries", "1"],
		);
		expect(verdict.verdict).toBe("agent_failed");
		expect(exitCode).toBe(1);
	}, 60_000);
	it("a real failure is not undone by the host breaking on retry", async () => {
		const { verdict, exitCode } = await runScenario(
			"instrument check fails, then the host fails on retry$",
			["--retries", "1"],
		);
		expect(verdict.verdict).toBe("agent_failed");
		expect(exitCode).toBe(1);
	}, 60_000);
	it("a secret in a failed check is not stored", async () => {
		const { summary } = await runScenario("instrument secret in a failed check$");
		const stored = JSON.stringify(summary?.attempts[0]?.errors);
		expect(stored).toContain("[redacted]");
		expect(stored).not.toContain(["sk", "abcdefghijklmnopqrst"].join("-"));
	}, 60_000);
});
describe("conditions a pass needs through the real runner", () => {
	it("an uncalibrated host gives an indicative run that names why", async () => {
		await rm(calibration, { recursive: true, force: true });
		try {
			const { verdict, exitCode } = await runScenario("instrument good run$");
			expect(verdict.verdict).toBe("indicative");
			expect(exitCode).toBe(3);
			expect(verdict.weakConditions?.[0]).toContain("no passing host probe");
		} finally {
			await calibrateFakeHost();
		}
	}, 60_000);
});
function recordsOf({ data }: { data: unknown[] }): unknown[] {
	return data.filter((item) => (item as { record?: object } | null)?.record !== undefined);
}
describe("verdict-grade runs through the real runner", () => {
	it("a verdict-grade run seals the real home and can still pass", async () => {
		const { verdict, exitCode, summary } = await runScenario("instrument good run$", [], {
			verdictGrade: true,
		});
		expect(verdict.verdict).toBe("passed");
		expect(exitCode).toBe(0);
		const records = (summary?.attempts ?? []).flatMap(({ operations }) =>
			operations.flatMap(recordsOf),
		);
		expect(records[0]).toMatchObject({ record: { home: "sealed", userConfig: "excluded" } });
	}, 60_000);
});
