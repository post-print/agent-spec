import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
}

export interface LiveScenarioCommand {
	command: string;
	args: string[];
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
	// Isolated child: agent + rubric only; parent runs judge (avoids OOM after heavy council runs).
	args.push("--no-judge");

	return { command: process.execPath, args };
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
	const { command, args } = buildLiveScenarioCommand(options);

	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, AGENT_TEST_CHILD: "1" },
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("close", (code, signal) => {
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
	if (exitCode === 137) {
		return "subprocess killed (137) — macOS OOM; close heavy apps or increase AGENT_TEST_SCENARIO_SETTLE_MS";
	}
	return `live scenario subprocess exited ${exitCode}`;
}
