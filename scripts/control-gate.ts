// Runs every behavior control. A control that survives means its test cannot tell good from bad.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONTROLS } from "../agent-suites/controls/manifest.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = fileURLToPath(new URL("../agent-suites/controls/control-host.mjs", import.meta.url));
const playwright = "node_modules/@playwright/test/cli.js";
const config = "agent-test.controls.config.ts";

type Spec = { tests: { results: { status: string; errors: { message?: string }[] }[] }[] };
type Suite = { specs?: Spec[]; suites?: Suite[] };
function specs(suite: Suite): Spec[] {
	return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
}
function runControl(title: string, behavior: string, judge = "accept") {
	const { stdout } = spawnSync(
		"node",
		[playwright, "test", "-c", config, "--reporter=json", "--grep", `${title}$`],
		{
			cwd: root,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			env: {
				...process.env,
				CLAUDE_CODE_BIN: host,
				AGENT_TEST_CONTROL: behavior,
				AGENT_TEST_JUDGE: judge,
			},
		},
	);
	const found = specs(JSON.parse(stdout) as Suite);
	const result = found[0]?.tests[0]?.results[0];
	if (found.length !== 1 || !result) throw new Error(`Expected one test titled: ${title}`);
	return {
		status: result.status,
		errors: result.errors.map(({ message }) => message ?? "").join("\n"),
	};
}
const problems: string[] = [];
function expectPass(title: string, behavior: string) {
	const { status, errors } = runControl(title, behavior);
	if (status !== "passed")
		problems.push(`${title}\n  ${behavior} must pass\n  ${errors.slice(0, 400)}`);
	console.log(`${status === "passed" ? "ok  " : "FAIL"} pass  ${behavior}`);
}
type Rejection = { title: string; label: string; mustFail: string };
function expectRejected(
	{ title, label, mustFail }: Rejection,
	outcome: ReturnType<typeof runControl>,
) {
	const rejected = outcome.status !== "passed" && outcome.errors.includes(mustFail);
	if (!rejected)
		problems.push(
			`${title}\n  ${label} must fail on "${mustFail}", but it ${outcome.status === "passed" ? "survived" : `failed on: ${outcome.errors.slice(0, 300)}`}`,
		);
	console.log(`${rejected ? "ok  " : "FAIL"} fail  ${label}`);
}
for (const { title, good, controls, judgeRejects } of CONTROLS) {
	console.log(title);
	expectPass(title, good);
	for (const { behavior, mustFail } of controls)
		expectRejected({ title, label: behavior, mustFail }, runControl(title, behavior));
	if (judgeRejects)
		expectRejected(
			{ title, label: "judge rejects", mustFail: judgeRejects.mustFail },
			runControl(title, good, "reject"),
		);
}
if (problems.length) {
	console.error(`\n${problems.length} control(s) failed:\n${problems.join("\n")}`);
	process.exit(1);
}
console.log("\nEvery control was rejected on the expected check.");
