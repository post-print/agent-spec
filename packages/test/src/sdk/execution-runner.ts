import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ExecutionStore,
	executionHistoryRoot,
	finishExecutionIfRunning,
} from "./execution-store.js";
import { playwrightCli } from "./playwright-cli.js";

export type StartedExecution = {
	id: string;
	cancel: () => void;
	completed: Promise<number>;
};

export type StartExecutionOptions = {
	config: string;
	args: string[];
	reporter?: string;
	onOutput?: (line: string) => void;
};

/** Starts one recorded Playwright process. CLI and viewer share this boundary. */
export async function startRecordedExecution(
	options: StartExecutionOptions,
): Promise<StartedExecution> {
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
	return {
		id,
		cancel: () => {
			cancelRequested = true;
			child.kill("SIGTERM");
		},
		completed: new Promise((resolveCode, reject) => {
			child.once("error", reject);
			child.once("close", (code) => {
				void finishExecutionIfRunning(root, cancelRequested ? "interrupted" : "failed").then(
					() => resolveCode(code ?? 1),
					reject,
				);
			});
		}),
	};
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
