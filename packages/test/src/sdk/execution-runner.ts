import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBaselines } from "./baselines.js";
import {
	ExecutionStore,
	executionHistoryRoot,
	finishExecutionIfRunning,
	readExecutionDetail,
	recoverExecutionHistory,
	saveExecutionVerdict,
} from "./execution-store.js";
import { playwrightCli } from "./playwright-cli.js";
import { reduceVerdict, type VerdictAttempt, type VerdictResult } from "./verdict.js";

export type StartedExecution = {
	id: string;
	cancel: () => void;
	/** The exit code for this run, from its verdict. */
	completed: Promise<number>;
	verdict: Promise<VerdictResult>;
};

export type StartExecutionOptions = {
	config: string;
	args: string[];
	reporter?: string;
	onOutput?: (line: string) => void;
	/** Report --repeat-each as rates instead of failing on a failed repeat. */
	measureRepeats?: boolean;
};

/** Starts one recorded Playwright process. CLI and viewer share this boundary. */
export async function startRecordedExecution(
	options: StartExecutionOptions,
): Promise<StartedExecution> {
	await recoverExecutionHistory(executionHistoryRoot(options.config));
	const id = crypto.randomUUID();
	const root = resolve(executionHistoryRoot(options.config), id);
	await ExecutionStore.create({
		root,
		id,
		config: options.config,
		ownerPid: process.pid,
	});
	const child = spawn(process.execPath, recordedExecutionArgs(options, root), {
		stdio: ["inherit", "pipe", "inherit"],
		env: {
			...process.env,
			AGENT_TEST_RECORDER: "1",
			AGENT_TEST_EXECUTION_ID: id,
			AGENT_TEST_EXECUTION_ROOT: root,
			AGENT_TEST_EXECUTION_CONFIG: options.config,
		},
	});
	pipeOutput(child.stdout, options.onOutput);
	let cancelRequested = false;
	const verdict = new Promise<VerdictResult>((resolveVerdict, reject) => {
		child.once("error", reject);
		child.once("close", (code) => {
			void concludeExecution({
				config: options.config,
				root,
				runnerExitCode: code ?? 1,
				cancelled: cancelRequested,
				listOnly: options.args.includes("--list"),
				measureRepeats: options.measureRepeats === true,
			}).then(resolveVerdict, reject);
		});
	});
	return {
		id,
		cancel: () => {
			cancelRequested = true;
			child.kill("SIGTERM");
		},
		verdict,
		completed: verdict.then(({ exitCode }) => exitCode),
	};
}

/** One test's identity across samples and repeats: its project and titles, without the file line. */
function claimKey(attempt: { project?: string; title: string[]; sample?: { title: string } }) {
	const titles = attempt.title.filter(Boolean);
	const path = attempt.sample ? [...titles.slice(0, -1), attempt.sample.title] : titles;
	return path.join(" › ");
}
async function concludeExecution(input: {
	config: string;
	root: string;
	runnerExitCode: number;
	cancelled: boolean;
	listOnly: boolean;
	measureRepeats: boolean;
}): Promise<VerdictResult> {
	const { config, root, runnerExitCode, cancelled, listOnly } = input;
	await finishExecutionIfRunning(root, cancelled ? "interrupted" : "failed");
	const detail = await readExecutionDetail(root);
	const attempts: VerdictAttempt[] = (detail?.attempts ?? []).map((attempt) => ({
		...attempt,
		claim: claimKey(attempt),
	}));
	const verdict = reduceVerdict({
		attempts,
		baselines: await readBaselines(config),
		measureRepeats: input.measureRepeats,
		interrupted: cancelled || detail?.status === "interrupted",
		listOnly,
		runnerExitCode,
	});
	await saveExecutionVerdict(root, verdict);
	return verdict;
}

function recordedExecutionArgs(options: StartExecutionOptions, root: string): string[] {
	return [
		playwrightCli(),
		"test",
		"--config",
		options.config,
		"--reporter",
		`${options.reporter ?? "list"},${executionReporterPath()}`,
		"--output",
		resolve(root, "test-results"),
		...options.args,
	];
}

function executionReporterPath(): string {
	const adjacent = new URL("./execution-reporter.js", import.meta.url);
	if (existsSync(adjacent)) return fileURLToPath(adjacent);
	return fileURLToPath(new URL("../../dist/sdk/execution-reporter.js", import.meta.url));
}

function pipeOutput(
	stream: NodeJS.ReadableStream | null,
	onOutput: ((line: string) => void) | undefined,
): void {
	if (!stream || !onOutput) return;
	let buffered = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string) => {
		const lines = `${buffered}${chunk}`.split("\n");
		buffered = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("@@agent-test:")) onOutput(line);
		}
	});
	stream.once("end", () => {
		if (buffered && !buffered.startsWith("@@agent-test:")) onOutput(buffered);
	});
}
