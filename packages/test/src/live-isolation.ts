import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { AgentHost, HostAuthMode } from "@post-print/agent-harness";
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
import type { AssertionFailure, CompareArmId, FailureCategory } from "./types.js";
import { VIEWER_EVENTS_FD, VIEWER_EVENTS_FD_ENV } from "./viewer/emit.js";
import { parseViewerEvent, type ViewerEvent } from "./viewer/events.js";

const activeChildren = new Set<ChildProcess>();

function registerActiveChild(child: ChildProcess): void {
	activeChildren.add(child);
}

function unregisterActiveChild(child: ChildProcess): void {
	activeChildren.delete(child);
}

/** Kill in-flight live scenario children (Ctrl+C / SIGINT / SIGTERM from parent). */
export function killActiveLiveChildren(): void {
	const children = [...activeChildren];
	for (const child of children) {
		try {
			child.kill("SIGTERM");
		} catch {
			// best-effort
		}
	}
	if (children.length === 0) {
		return;
	}
	setTimeout(() => {
		for (const child of children) {
			if (child.exitCode !== null || child.signalCode !== null) {
				continue;
			}
			try {
				child.kill("SIGKILL");
			} catch {
				// best-effort
			}
		}
	}, LIVE_SUBPROCESS_SIGKILL_ESCALATION_MS);
}

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
const FAST_SCENARIO_SETTLE_MS = 500;

/** Child process per live scenario (default) — avoids macOS OOM (exit 137) across council runs. */
export function liveScenarioIsolationEnabled(): boolean {
	return process.env.AGENT_TEST_CHILD !== "1" && process.env.AGENT_TEST_NO_ISOLATE !== "1";
}

/** Delay between isolated live subprocess scenarios (adaptive after success). */
export function scenarioSettleMs(previousExitCode?: number): number {
	const raw = process.env.AGENT_TEST_SCENARIO_SETTLE_MS?.trim();
	if (raw !== undefined && raw !== "") {
		const parsed = Number(raw);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SCENARIO_SETTLE_MS;
	}
	if (previousExitCode === 0) {
		return FAST_SCENARIO_SETTLE_MS;
	}
	return DEFAULT_SCENARIO_SETTLE_MS;
}

export interface SpawnLiveScenarioOptions {
	/** CLI entrypoint to execute. Detached viewer sessions must not reuse their server entrypoint. */
	cliPath?: string;
	cwd: string;
	suiteName: string;
	scenarioName: string;
	suitesDir: string;
	rubricsDir?: string;
	suiteFilter?: string;
	stagingSessionId?: string;
	keepRecordings?: boolean;
	worktree?: boolean;
	judge?: boolean;
	/** Agent host; forwarded so the child does not fall back to the cursor default. */
	host?: AgentHost;
	/** Consumer adapter modules; forwarded so the child can register the same hosts. */
	adapterModules?: string[];
	/** 1-based index in the full suite (for child CLI counters). */
	scenarioIndex?: number;
	/** Total scenarios in the full suite (for child CLI counters). */
	scenarioTotal?: number;
	/** In-process harness timeout (parent adds a kill backstop). */
	timeoutMs?: number;
	/** Previous subprocess exit code — shortens settle after success when unsettled env default applies. */
	previousExitCode?: number;
	/** Disable harness deadline in the child (forwards --no-timeout). */
	noTimeout?: boolean;
	/** Allow AskQuestion-style tools (default false — live is single-shot). */
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
	/** Host billing mode. Forwarded so the child does not fall back to env or default. */
	authMode?: HostAuthMode;
	/** Isolated single compare arm. */
	compareArm?: CompareArmId;
	/** Parent receives NDJSON viewer events from child fd 3. */
	onViewerEvent?: (event: ViewerEvent) => void;
	/** Viewer cancel / parent abort. Skip settle and stop this child. */
	signal?: AbortSignal;
}

export interface LiveScenarioCommand {
	command: string;
	args: string[];
	execArgv: string[];
}

/** Build the Node subprocess command for one live scenario (same CLI entry as the parent). */
export function buildLiveScenarioCommand(options: SpawnLiveScenarioOptions): LiveScenarioCommand {
	const cliPath =
		options.cliPath ??
		process.argv[1] ??
		resolve(options.cwd, "node_modules/@post-print/agent-test/dist/cli.js");
	const args = [cliPath, "--scenario", options.scenarioName];
	if (options.suiteFilter) {
		args.push("--suite", options.suiteFilter);
	}
	if (options.suitesDir !== "agent-suites") {
		args.push("--suites-dir", options.suitesDir);
	}
	if (options.rubricsDir) {
		args.push("--rubrics-dir", options.rubricsDir);
	}
	if (options.stagingSessionId) {
		args.push("--staging-session-id", options.stagingSessionId);
	}
	if (options.keepRecordings) {
		args.push("--keep-recordings");
	}
	if (options.worktree === false) {
		args.push("--no-worktree");
	}
	// Without these the child re-runs preflight with the cursor defaults and
	// demands CURSOR_API_KEY, whatever the parent was asked to run.
	if (options.host) {
		args.push("--host", options.host);
	}
	for (const modulePath of options.adapterModules ?? []) {
		args.push("--adapter", modulePath);
	}
	if (options.judge === false) {
		args.push("--no-judge");
	}
	if (options.noTimeout) {
		args.push("--no-timeout");
	} else if (options.timeoutMs !== undefined) {
		args.push("--timeout-ms", String(options.timeoutMs));
	}
	if (options.allowUserInput) {
		args.push("--allow-user-input");
	}
	if (options.authMode) {
		args.push("--auth-mode", options.authMode);
	}
	if (options.compareArm) {
		args.push("--compare-arm", options.compareArm);
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

export interface SpawnLiveScenarioResult {
	exitCode: number;
	/** Child stderr, also written through to the parent stderr. */
	stderr: string;
}

/** Run one live scenario in a fresh Node subprocess; inherit stdout for live progress. */
export async function spawnLiveScenario(
	options: SpawnLiveScenarioOptions,
): Promise<SpawnLiveScenarioResult> {
	const { command, args, execArgv } = buildLiveScenarioCommand(options);

	const captureEvents = options.onViewerEvent !== undefined;
	const env: NodeJS.ProcessEnv = {
		...process.env,
		AGENT_TEST_CHILD: "1",
	};
	if (captureEvents) {
		env[VIEWER_EVENTS_FD_ENV] = String(VIEWER_EVENTS_FD);
	}
	if (options.scenarioIndex !== undefined) {
		env.AGENT_TEST_SCENARIO_INDEX = String(options.scenarioIndex);
	}
	if (options.scenarioTotal !== undefined) {
		env.AGENT_TEST_SCENARIO_TOTAL = String(options.scenarioTotal);
	}

	const agentTimeoutMs = options.timeoutMs;
	const subprocessTimeoutMs = liveSubprocessTimeoutMs(agentTimeoutMs);
	const stderrChunks: string[] = [];

	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const child = spawn(command, [...execArgv, ...args], {
			cwd: options.cwd,
			env,
			stdio: captureEvents
				? // Viewer children stream structured activity through fd 3. Do not inherit
					// the detached session server's one-shot startup stdout pipe: it is closed
					// after the server publishes its URL and would crash child console output
					// with EPIPE before it can write its authoritative result.
					["ignore", "ignore", "pipe", "pipe"]
				: ["inherit", "inherit", "pipe"],
		});
		if (captureEvents) {
			const eventStream = child.stdio[VIEWER_EVENTS_FD];
			if (eventStream && typeof eventStream !== "number" && "on" in eventStream) {
				let buffer = "";
				eventStream.on("data", (chunk: Buffer | string) => {
					buffer += String(chunk);
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) {
						const event = parseViewerEvent(line);
						if (event) {
							options.onViewerEvent?.(event);
						}
					}
				});
			}
		}
		let stderrLine = "";
		child.stderr?.on("data", (chunk: Buffer | string) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			stderrChunks.push(text);
			process.stderr.write(text);
			if (!captureEvents || !options.host) {
				return;
			}
			stderrLine += text;
			const lines = stderrLine.split("\n");
			stderrLine = lines.pop() ?? "";
			for (const line of lines) {
				const plain = stripVTControlCharacters(line).trim();
				if (!plain) {
					continue;
				}
				options.onViewerEvent?.({
					type: "status",
					text: plain.length > 400 ? `${plain.slice(0, 400)}…` : plain,
					suite: options.suiteName,
					scenario: options.scenarioName,
					host: options.host,
					...(options.compareArm ? { arm: options.compareArm } : {}),
				});
			}
		});
		registerActiveChild(child);
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
		const escalateToSigkill = () => {
			if (sigkillId !== undefined) {
				return;
			}
			sigkillId = setTimeout(() => {
				if (childClosed) {
					return;
				}
				child.kill("SIGKILL");
			}, LIVE_SUBPROCESS_SIGKILL_ESCALATION_MS);
		};
		const killChildForCancel = () => {
			if (childClosed) {
				return;
			}
			child.kill("SIGTERM");
			escalateToSigkill();
		};
		const killChildForTimeout = () => {
			if (childClosed || killedForTimeout) {
				return;
			}
			killedForTimeout = true;
			child.kill("SIGTERM");
			escalateToSigkill();
		};
		if (options.signal?.aborted) {
			killChildForCancel();
		} else {
			options.signal?.addEventListener("abort", killChildForCancel, { once: true });
		}
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
				options.compareArm,
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
			unregisterActiveChild(child);
			clearKillTimers();
			reject(error);
		});
		child.on("close", (code, signal) => {
			childClosed = true;
			unregisterActiveChild(child);
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

	if (options.signal?.aborted) {
		return { exitCode, stderr: stderrChunks.join("") };
	}
	const settleMs = scenarioSettleMs(exitCode);
	if (settleMs > 0) {
		await sleep(settleMs);
	}
	return { exitCode, stderr: stderrChunks.join("") };
}

function appendChildStderr(message: string, stderr?: string): string {
	const trimmed = stderr?.trim();
	if (!trimmed) {
		return message;
	}
	const snippet = trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;
	return `${message}\n${snippet}`;
}

export function subprocessFailureMessage(exitCode: number, stderr?: string): string {
	if (exitCode === 124) {
		return appendChildStderr(
			"live scenario subprocess timed out (harness deadline exceeded)",
			stderr,
		);
	}
	if (exitCode === 137) {
		return appendChildStderr(
			"subprocess killed (137) — macOS OOM; close heavy apps or increase AGENT_TEST_SCENARIO_SETTLE_MS",
			stderr,
		);
	}
	return appendChildStderr(`live scenario subprocess exited ${exitCode}`, stderr);
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
	childStderr?: string,
): AssertionFailure[] {
	if (exitCode === 0) {
		return [];
	}
	if (childResult?.failures.length) {
		return childResult.failures.map((failure, index) =>
			assertionFailure(
				failure.matcher,
				failure.message,
				categoryFromLegacyFailure(failure),
				index === 0
					? appendChildStderr(failure.evidence ?? "", childStderr) || failure.evidence
					: failure.evidence,
			),
		);
	}
	if (exitCode === 124 && childResult?.passed === true) {
		return [];
	}
	return [
		assertionFailure(
			"liveScenario",
			subprocessFailureMessage(exitCode, childStderr),
			"agent_runtime",
		),
	];
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
