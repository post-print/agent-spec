import { relative, resolve } from "node:path";
import { baselineDirectory, type SavedBaselines, saveBaselines } from "./baselines.js";
import { claimLines } from "./claims.js";
import { startRecordedExecution } from "./execution-runner.js";
import { executionHistoryRoot, listExecutionHistory } from "./execution-store.js";
import { type RunVerdict, verdictNotes, verdictSentence } from "./verdict.js";

export { playwrightCli } from "./playwright-cli.js";

/**
 * Only a rate that stood can become the bar later runs are held to. A failed, flagged or regressed
 * claim would lower it, and a run with no verdict says nothing it could be held to.
 */
const FIT_FOR_BASELINES = new Set<RunVerdict>(["passed", "indicative"]);
async function saveLatestBaselines(config: string): Promise<SavedBaselines> {
	const root = executionHistoryRoot(config);
	const summaries = await listExecutionHistory(root);
	const latest = summaries.find((summary) => summary.verdict?.claims.length)?.verdict;
	if (!latest) return { saved: [], skipped: [] };
	if (!FIT_FOR_BASELINES.has(latest.verdict))
		return { saved: [], skipped: [{ claim: "the newest run", reason: latest.verdict }] };
	const standing = latest.claims.filter((claim) =>
		FIT_FOR_BASELINES.has(latest.claimVerdicts?.[claim.claim] ?? "instrument_error"),
	);
	const refused = latest.claims
		.filter((claim) => !standing.includes(claim))
		.map(({ claim }) => ({ claim, reason: latest.claimVerdicts?.[claim] ?? "no verdict" }));
	const result = await saveBaselines(config, standing);
	return { ...result, skipped: [...refused, ...result.skipped] };
}

type RunnerArgument =
	| { kind: "config"; value: string; next: number }
	| { kind: "reporter"; value: string; next: number }
	| { kind: "pass"; value: string; next: number };
function runnerArgument(args: string[], index: number): RunnerArgument {
	const value = args[index] ?? "";
	if (value === "--config" || value === "-c")
		return { kind: "config", value: args[index + 1] ?? "agent-test.config.ts", next: index + 2 };
	if (value === "--reporter")
		return { kind: "reporter", value: args[index + 1] ?? "list", next: index + 2 };
	if (value.startsWith("--reporter="))
		return {
			kind: "reporter",
			value: value.slice("--reporter=".length) || "list",
			next: index + 1,
		};
	return { kind: "pass", value, next: index + 1 };
}
function runnerArguments(args: string[]) {
	let config = resolve("agent-test.config.ts");
	let reporter = "list";
	const passThrough: string[] = [];
	for (let index = 0; index < args.length; ) {
		const argument = runnerArgument(args, index);
		index = argument.next;
		switch (argument.kind) {
			case "config":
				config = resolve(argument.value);
				break;
			case "reporter":
				reporter = argument.value;
				break;
			case "pass":
				passThrough.push(argument.value);
		}
	}
	return { config, reporter, passThrough };
}
/** Flags agent-test reads itself. Every other argument goes to Playwright. */
const OWN_FLAGS = ["--measure", "--allow-indicative", "--verdict-grade"];
export async function runSdkCli(args: string[]): Promise<number> {
	const { config, reporter: requestedReporter, passThrough: parsed } = runnerArguments(args);
	const passThrough = parsed.filter((argument) => !OWN_FLAGS.includes(argument));
	const execution = await startRecordedExecution({
		config,
		measureRepeats: parsed.includes("--measure"),
		allowIndicative: parsed.includes("--allow-indicative"),
		verdictGrade: parsed.includes("--verdict-grade"),
		args: passThrough,
		reporter: requestedReporter,
		onOutput: (line) => process.stdout.write(`${line}\n`),
	});
	const cancel = () => execution.cancel();
	process.once("SIGINT", cancel);
	try {
		const code = await execution.completed;
		const result = await execution.verdict;
		if (!passThrough.includes("--list"))
			process.stdout.write(
				`${[verdictSentence(result), ...verdictNotes(result), ...result.claims.flatMap(claimLines)].join("\n")}\n`,
			);
		if (!passThrough.includes("--list"))
			for (const line of viewerHint({
				config,
				executionId: execution.id,
				interactive: process.stdout.isTTY === true,
				ci: process.env.CI === "true",
			}))
				process.stdout.write(`${line}\n`);
		return code;
	} finally {
		process.removeListener("SIGINT", cancel);
	}
}

/**
 * Closing lines after a recorded run. A terminal user gets the command; a non-interactive
 * caller, usually a coding agent, is also told to ask before starting the viewer.
 */
export function viewerHint(input: {
	config: string;
	executionId: string;
	interactive: boolean;
	ci: boolean;
}): string[] {
	if (input.ci) return [];
	const configPath = relative(process.cwd(), input.config);
	const command =
		configPath === "agent-test.config.ts"
			? "agent-test viewer"
			: `agent-test viewer --config ${configPath}`;
	const lines = [`View run ${input.executionId.slice(0, 8)}: ${command}`];
	if (!input.interactive)
		lines.push(
			"Agent: ask the user whether to open the results viewer; start it only if they agree.",
		);
	return lines;
}

/** Saves the newest run's sampled claims as the baselines later runs compare against. */
export async function runBaselineCli(args: string[]): Promise<number> {
	const { config } = runnerArguments(args);
	const { saved, skipped } = await saveLatestBaselines(config);
	const where = relative(process.cwd(), baselineDirectory(config));
	process.stdout.write(
		saved.length
			? `Saved ${saved.length} baselines to ${where}. Commit them.\n`
			: "The newest run has no sampled claims to save.\n",
	);
	for (const { claim, reason } of skipped) process.stdout.write(`Not saved: ${claim}: ${reason}\n`);
	return 0;
}
