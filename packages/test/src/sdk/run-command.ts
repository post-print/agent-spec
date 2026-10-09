import { type ExecException, execFile } from "node:child_process";

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}
export interface RunCommandOptions {
	/** Milliseconds before the command is killed and the call rejects. Default 120000. */
	timeoutMs?: number;
	signal?: AbortSignal;
	env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function failureExitCode(error: ExecException): number | undefined {
	return typeof error.code === "number" ? error.code : undefined;
}

/**
 * Run one program with an argument list (never a shell string) in `directory`.
 * Tests use it to verify a run's final workspace copy themselves rather than trusting
 * commands the agent reported. A nonzero exit resolves; a timeout, abort, or missing
 * program rejects.
 */
export function runCommand(
	directory: string,
	argv: readonly [string, ...string[]],
	options: RunCommandOptions = {},
): Promise<CommandResult> {
	const [program, ...args] = argv;
	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		execFile(
			program,
			args,
			{
				cwd: directory,
				timeout,
				signal: options.signal,
				env: options.env,
				maxBuffer: MAX_OUTPUT_BYTES,
			},
			(error, stdout, stderr) => {
				if (!error) return resolve({ exitCode: 0, stdout, stderr });
				const exitCode = failureExitCode(error);
				if (exitCode === undefined || error.killed)
					return reject(
						new Error(`Command failed to complete: ${argv.join(" ")}: ${error.message}`),
					);
				resolve({ exitCode, stdout, stderr });
			},
		);
	});
}
