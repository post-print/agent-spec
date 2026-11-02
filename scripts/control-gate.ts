// Runs every behavior control through agent-test itself, so the verdict and exit code it would
// give are what the gate checks. A control that survives means its test cannot tell good from bad.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTROLS } from "../agent-suites/controls/manifest.ts";
import { startRecordedExecution } from "../packages/test/dist/sdk/execution-runner.js";
import {
	executionHistoryRoot,
	readExecutionDetail,
} from "../packages/test/dist/sdk/execution-store.js";

const host = fileURLToPath(new URL("../agent-suites/controls/control-host.mjs", import.meta.url));
const config = fileURLToPath(new URL("../agent-test.controls.config.ts", import.meta.url));

type Outcome = { verdict: string; exitCode: number; errors: string };
async function runControl(title: string, behavior: string, judge = "accept"): Promise<Outcome> {
	Object.assign(process.env, {
		CLAUDE_CODE_BIN: host,
		AGENT_TEST_CONTROL: behavior,
		AGENT_TEST_JUDGE: judge,
	});
	const execution = await startRecordedExecution({
		config,
		args: ["--grep", `${title}$`, "--workers", "1"],
	});
	const root = join(executionHistoryRoot(config), execution.id);
	try {
		const exitCode = await execution.completed;
		const result = await execution.verdict;
		const tests = Object.keys(result.tests).length;
		if (tests !== 1) throw new Error(`Expected one test titled: ${title}, found ${tests}`);
		const detail = await readExecutionDetail(root);
		const errors = (detail?.attempts ?? []).flatMap((attempt) =>
			attempt.errors.map((error) => (error as { message?: string }).message ?? ""),
		);
		return { verdict: result.verdict, exitCode, errors: errors.join("\n") };
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
const problems: string[] = [];
async function expectPass(title: string, behavior: string) {
	const { verdict, exitCode, errors } = await runControl(title, behavior);
	const passed = verdict === "passed" && exitCode === 0;
	if (!passed)
		problems.push(
			`${title}\n  ${behavior} must pass with exit 0, but was ${verdict} (exit ${exitCode})\n  ${errors.slice(0, 400)}`,
		);
	console.log(`${passed ? "ok  " : "FAIL"} pass  ${behavior}`);
}
type Rejection = { title: string; label: string; mustFail: string };
/** Rejected means charged to the agent, exit 1, on the named check: no other failure will do. */
function expectRejected({ title, label, mustFail }: Rejection, outcome: Outcome) {
	const charged = outcome.verdict === "agent_failed" && outcome.exitCode === 1;
	const rejected = charged && outcome.errors.includes(mustFail);
	if (!rejected)
		problems.push(
			`${title}\n  ${label} must fail as agent_failed (exit 1) on "${mustFail}", but was ${outcome.verdict} (exit ${outcome.exitCode}): ${outcome.errors.slice(0, 300)}`,
		);
	console.log(`${rejected ? "ok  " : "FAIL"} fail  ${label}`);
}
for (const { title, good, controls, judgeRejects } of CONTROLS) {
	console.log(title);
	await expectPass(title, good);
	for (const { behavior, mustFail } of controls)
		expectRejected({ title, label: behavior, mustFail }, await runControl(title, behavior));
	if (judgeRejects)
		expectRejected(
			{ title, label: "judge rejects", mustFail: judgeRejects.mustFail },
			await runControl(title, good, "reject"),
		);
}
if (problems.length) {
	console.error(`\n${problems.length} control(s) failed:\n${problems.join("\n")}`);
	process.exit(1);
}
console.log("\nEvery control was rejected on the expected check.");
