import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { liveSubprocessTimeoutMs } from "./live-timeout.js";

const DEFAULT_SCENARIO_SETTLE_MS = 5000;

/** Child process per live scenario (default) — avoids macOS OOM (exit 137) across council runs. */
export function liveScenarioIsolationEnabled(): boolean {
	return (
		process.env.AGENT_TEST_CHILD !== "1" &&
		process.env.AGENT_TEST_NO_ISOLATE !== "1"
	);
}

export function scenarioSettleMs(): number {
	const raw =
		process.env.AGENT_TEST_SCENARIO_SETTLE_MS ??
		String(DEFAULT_SCENARIO_SETTLE_MS);
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0
		? parsed
		: DEFAULT_SCENARIO_SETTLE_MS;
}

export interface SpawnLiveScenarioOptions {
	cwd: string;
	suiteName: string;
	scenarioName: string;
	suitesDir: string;
	suiteFilter?: string;
	stagingSessionId?: string;
	keepRecordings?: boolean;
	recordFixtures?: boolean;
	worktree?: boolean;
	judge?: boolean;
	/** 1-based index in the full suite (for child CLI counters). */
	scenarioIndex?: number;
	/** Total scenarios in the full suite (for child CLI counters). */
	scenarioTotal?: number;
	/** In-process harness timeout (parent adds a kill backstop). */
	timeoutMs?: number;
}

export interface LiveScenarioCommand {
	command: string;
	args: string[];
	execArgv: string[];
}

/** Build the Node subprocess command for one live scenario (same CLI entry as the parent). */
export function buildLiveScenarioCommand(
	options: SpawnLiveScenarioOptions,
): LiveScenarioCommand {
	const cliPath =
		process.argv[1] ??
		resolve(options.cwd, "node_modules/@post-print/agent-test/dist/cli.js");
	const args = [cliPath, "--live", "--scenario", options.scenarioName];
	if (options.suiteFilter) {
		args.push("--suite", options.suiteFilter);
	}
	if (options.suitesDir !== "agent-suites") {
		args.push("--suites-dir", options.suitesDir);
	}
	if (options.stagingSessionId) {
		args.push("--staging-session-id", options.stagingSessionId);
	}
	if (options.keepRecordings) {
		args.push("--keep-recordings");
	}
	if (options.recordFixtures) {
		args.push("--record-fixtures");
	}
	if (options.worktree === false) {
		args.push("--no-worktree");
	}
	if (options.timeoutMs !== undefined) {
		args.push("--timeout-ms", String(options.timeoutMs));
	}
	// Isolated child: agent + rubric only; parent runs judge (avoids OOM after heavy council runs).
	args.push("--no-judge");

	return {
		command: process.execPath,
		args,
		execArgv: ["--disable-warning=ExperimentalWarning"],
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolveSleep) => {
		setTimeout(resolveSleep, ms);
	});
}

/** Run one live scenario in a fresh Node subprocess; inherit stdio for live progress. */
export async function spawnLiveScenario(
	options: SpawnLiveScenarioOptions,
): Promise<number> {
	const { command, args, execArgv } = buildLiveScenarioCommand(options);

	const env: NodeJS.ProcessEnv = {
		...process.env,
		AGENT_TEST_CHILD: "1",
	};
	if (options.scenarioIndex !== undefined) {
		env.AGENT_TEST_SCENARIO_INDEX = String(options.scenarioIndex);
	}
	if (options.scenarioTotal !== undefined) {
		env.AGENT_TEST_SCENARIO_TOTAL = String(options.scenarioTotal);
	}

	const subprocessTimeoutMs = liveSubprocessTimeoutMs(options.timeoutMs);

	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const child = spawn(command, [...execArgv, ...args], {
			cwd: options.cwd,
			env,
			stdio: "inherit",
		});
		let killedForTimeout = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (subprocessTimeoutMs !== undefined) {
			timeoutId = setTimeout(() => {
				killedForTimeout = true;
				child.kill("SIGTERM");
			}, subprocessTimeoutMs);
		}
		child.on("error", (error) => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
			}
			reject(error);
		});
		child.on("close", (code, signal) => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
			}
			if (killedForTimeout) {
				resolveExit(124);
				return;
			}
			if (signal === "SIGKILL") {
				resolveExit(137);
				return;
			}
			resolveExit(code ?? 1);
		});
	});

	const settleMs = scenarioSettleMs();
	if (settleMs > 0) {
		await sleep(settleMs);
	}
	return exitCode;
}

export function subprocessFailureMessage(exitCode: number): string {
	if (exitCode === 124) {
		return "live scenario subprocess timed out (harness deadline exceeded)";
	}
	if (exitCode === 137) {
		return "subprocess killed (137) — macOS OOM; close heavy apps or increase AGENT_TEST_SCENARIO_SETTLE_MS";
	}
	return `live scenario subprocess exited ${exitCode}`;
}

/** Parent-provided counters for isolated child runs (1-based index). */
export function parentScenarioCounters():
	| { index: number; total: number }
	| undefined {
	const index = Number(process.env.AGENT_TEST_SCENARIO_INDEX);
	const total = Number(process.env.AGENT_TEST_SCENARIO_TOTAL);
	if (
		Number.isInteger(index) &&
		index > 0 &&
		Number.isInteger(total) &&
		total > 0
	) {
		return { index, total };
	}
	return undefined;
}
