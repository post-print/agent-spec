import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { assertionFailure } from "./failures.js";
import {
	LIVE_SUBPROCESS_SETUP_MAX_MS,
	LIVE_SUBPROCESS_SIGKILL_ESCALATION_MS,
	LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS,
	liveSubprocessTimeoutMs,
} from "./live-timeout.js";
import {
	getLiveStagingRootOverride,
	getStagingAgentStartPath,
	readAgentStartMarker,
} from "./record-trace.js";
import type { AssertionFailure, FailureCategory } from "./types.js";

function categoryFromLegacyFailure(failure: {
	matcher: string;
	message: string;
	category?: FailureCategory;
}): FailureCategory {
	if (failure.category) {
		return failure.category;
	}
	if (failure.matcher === "workingTreeLeak") {
		return "worktree_leak";
	}
	if (failure.matcher === "recordTrace") {
		return "recording_error";
	}
	if (failure.matcher === "runAgent" || failure.matcher === "liveScenario") {
		return "agent_runtime";
	}
	if (failure.matcher === "judge" || failure.matcher.startsWith("judge:")) {
		return failure.message.includes("judge run status") ||
			failure.message.includes("CURSOR_API_KEY")
			? "judge_infra"
			: "rubric_miss";
	}
	return "rubric_miss";
}

const DEFAULT_SCENARIO_SETTLE_MS = 5000;

/** Child process per live scenario (default) — avoids macOS OOM (exit 137) across council runs. */
export function liveScenarioIsolationEnabled(): boolean {
	return process.env.AGENT_TEST_CHILD !== "1" && process.env.AGENT_TEST_NO_ISOLATE !== "1";
}

export function scenarioSettleMs(): number {
	const raw = process.env.AGENT_TEST_SCENARIO_SETTLE_MS ?? String(DEFAULT_SCENARIO_SETTLE_MS);
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SCENARIO_SETTLE_MS;
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
	/** Disable harness deadline in the child (forwards --no-timeout). */
	noTimeout?: boolean;
	/** Allow AskQuestion-style tools (default false — live is single-shot). */
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
}

export interface LiveScenarioCommand {
	command: string;
	args: string[];
	execArgv: string[];
}

/** Build the Node subprocess command for one live scenario (same CLI entry as the parent). */
export function buildLiveScenarioCommand(options: SpawnLiveScenarioOptions): LiveScenarioCommand {
	const cliPath =
		process.argv[1] ?? resolve(options.cwd, "node_modules/@post-print/agent-test/dist/cli.js");
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
	if (options.noTimeout) {
		args.push("--no-timeout");
	} else if (options.timeoutMs !== undefined) {
		args.push("--timeout-ms", String(options.timeoutMs));
	}
	if (options.allowUserInput) {
		args.push("--allow-user-input");
	}
	if (options.debug) {
		args.push("--debug");
	}
	// Prefer explicit debugDir; fall back to process-global staging override so
	// library callers of setLiveStagingRootOverride stay parent/child aligned.
	const debugDir = options.debugDir ?? getLiveStagingRootOverride();
	if (debugDir) {
		args.push("--debug-dir", debugDir);
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

async function waitForAgentStartMarker(
	path: string,
	deadlineMs: number,
	pollMs = 100,
	shouldStop?: () => boolean,
): Promise<number | undefined> {
	const started = Date.now();
	while (Date.now() - started < deadlineMs) {
		if (shouldStop?.()) {
			return undefined;
		}
		const marker = await readAgentStartMarker(path);
		if (marker !== undefined) {
			return marker;
		}
		await sleep(pollMs);
	}
	return undefined;
}

/** Delay from agent-start marker until parent SIGTERM (harness deadline + cleanup slack). */
export function subprocessKillDelayMs(agentStartMs: number, agentTimeoutMs: number): number {
	return agentStartMs + agentTimeoutMs + LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS - Date.now();
}

/** Run one live scenario in a fresh Node subprocess; inherit stdio for live progress. */
export async function spawnLiveScenario(options: SpawnLiveScenarioOptions): Promise<number> {
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

	const agentTimeoutMs = options.timeoutMs;
	const subprocessTimeoutMs = liveSubprocessTimeoutMs(agentTimeoutMs);

	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const child = spawn(command, [...execArgv, ...args], {
			cwd: options.cwd,
			env,
			stdio: "inherit",
		});
		let childClosed = false;
		let killedForTimeout = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let sigkillId: ReturnType<typeof setTimeout> | undefined;
		const clearKillTimers = () => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			if (sigkillId !== undefined) {
				clearTimeout(sigkillId);
				sigkillId = undefined;
			}
		};
		const killChildForTimeout = () => {
			if (childClosed || killedForTimeout) {
				return;
			}
			killedForTimeout = true;
			child.kill("SIGTERM");
			sigkillId = setTimeout(() => {
				if (childClosed) {
					return;
				}
				child.kill("SIGKILL");
			}, LIVE_SUBPROCESS_SIGKILL_ESCALATION_MS);
		};
		const armKillTimer = (delayMs: number) => {
			if (childClosed) {
				return;
			}
			if (delayMs <= 0) {
				killChildForTimeout();
				return;
			}
			timeoutId = setTimeout(killChildForTimeout, delayMs);
		};

		if (agentTimeoutMs && agentTimeoutMs > 0 && options.stagingSessionId && !options.noTimeout) {
			const markerPath = getStagingAgentStartPath(
				options.stagingSessionId,
				options.suiteName,
				options.scenarioName,
			);
			void (async () => {
				const agentStartMs = await waitForAgentStartMarker(
					markerPath,
					LIVE_SUBPROCESS_SETUP_MAX_MS,
					100,
					() => childClosed,
				);
				if (childClosed) {
					return;
				}
				if (agentStartMs === undefined) {
					killChildForTimeout();
					return;
				}
				armKillTimer(subprocessKillDelayMs(agentStartMs, agentTimeoutMs));
			})();
		} else if (subprocessTimeoutMs !== undefined) {
			armKillTimer(subprocessTimeoutMs);
		}

		child.on("error", (error) => {
			childClosed = true;
			clearKillTimers();
			reject(error);
		});
		child.on("close", (code, signal) => {
			childClosed = true;
			clearKillTimers();
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

export interface LiveSubprocessStagingResult {
	passed: boolean;
	failures: AssertionFailure[];
}

/**
 * Map isolated child exit + optional staging sidecar to parent failures.
 * A persisted pass sidecar wins only over a late timeout kill (exit 124).
 * Other non-zero exits (cleanup failure, OOM 137, crashes) fail closed.
 */
export function failuresForLiveSubprocessExit(
	exitCode: number,
	childResult: LiveSubprocessStagingResult | undefined,
): AssertionFailure[] {
	if (exitCode === 0) {
		return [];
	}
	if (childResult?.failures.length) {
		return childResult.failures.map((failure) =>
			assertionFailure(
				failure.matcher,
				failure.message,
				categoryFromLegacyFailure(failure),
				failure.evidence,
			),
		);
	}
	if (exitCode === 124 && childResult?.passed === true) {
		return [];
	}
	return [assertionFailure("liveScenario", subprocessFailureMessage(exitCode), "agent_runtime")];
}

/** Parent-provided counters for isolated child runs (1-based index). */
export function parentScenarioCounters(): { index: number; total: number } | undefined {
	const index = Number(process.env.AGENT_TEST_SCENARIO_INDEX);
	const total = Number(process.env.AGENT_TEST_SCENARIO_TOTAL);
	if (Number.isInteger(index) && index > 0 && Number.isInteger(total) && total > 0) {
		return { index, total };
	}
	return undefined;
}
