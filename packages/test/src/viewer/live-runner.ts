import type { HostAuthMode } from "@post-print/agent-harness";

import { missingAgentAuth } from "../doctor.js";
import {
	killActiveLiveChildren,
	type SpawnLiveScenarioOptions,
	type SpawnLiveScenarioResult,
	spawnLiveScenario,
	subprocessFailureMessage,
} from "../live-isolation.js";
import { createLiveStagingSessionId } from "../record-trace.js";
import type { ViewerJob } from "./catalog.js";
import type { ViewerEvent, ViewerEventEnvelope } from "./events.js";
import type { ViewerRunner } from "./run-controller.js";

export interface LiveViewerRunnerOptions {
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
	judge?: boolean;
	timeoutMs?: number;
	authMode?: HostAuthMode;
	adapterModules?: string[];
	/** Override host auth probe. Tests inject this. */
	missingAuth?: (host: ViewerJob["host"]) => string | undefined;
	/** Override isolated spawn. Tests inject this. */
	spawnLiveScenario?: (options: SpawnLiveScenarioOptions) => Promise<SpawnLiveScenarioResult>;
}

function envelope(job: ViewerJob): ViewerEventEnvelope {
	return {
		suite: job.suite,
		scenario: job.scenario,
		host: job.host,
		...(job.arm ? { arm: job.arm } : {}),
	};
}

/** Spawn one isolated child per viewer job. Forward NDJSON events to the UI. */
export function createLiveViewerRunner(options: LiveViewerRunnerOptions): ViewerRunner {
	return {
		async runJob(job, emit, signal) {
			const cell = envelope(job);
			emit({ type: "cell_started", ...cell });
			emit({ type: "status", text: "Starting isolated child.", ...cell });
			const missing = (options.missingAuth ?? missingAgentAuth)(job.host);
			if (missing) {
				emit({ type: "error", message: missing, ...cell });
				emit({
					type: "cell_finished",
					...cell,
					passed: false,
					durationMs: 0,
					failures: [{ matcher: "liveScenario", message: missing }],
				});
				return;
			}
			if (signal.aborted) {
				return;
			}
			const onAbort = (): void => {
				killActiveLiveChildren();
			};
			signal.addEventListener("abort", onAbort, { once: true });
			const spawn = options.spawnLiveScenario ?? spawnLiveScenario;
			let finished = false;
			try {
				const result = await spawn({
					cwd: options.cwd,
					suiteName: job.suite,
					scenarioName: job.scenario,
					suitesDir: options.suitesDir,
					rubricsDir: options.rubricsDir,
					suiteFilter: job.suite,
					host: job.host,
					compareArm: job.arm,
					stagingSessionId: createLiveStagingSessionId(),
					judge: options.judge,
					timeoutMs: options.timeoutMs,
					noTimeout: options.timeoutMs === 0,
					authMode: options.authMode,
					adapterModules: options.adapterModules,
					signal,
					onViewerEvent: (event: ViewerEvent) => {
						if (event.type === "cell_finished") {
							finished = true;
						}
						if (signal.aborted) {
							return;
						}
						emit(event);
					},
				});
				if (signal.aborted) {
					return;
				}
				if (!finished && result.exitCode !== 0) {
					const message = subprocessFailureMessage(result.exitCode, result.stderr);
					emit({ type: "error", message, ...cell });
					emit({
						type: "cell_finished",
						...cell,
						passed: false,
						durationMs: 0,
						failures: [{ matcher: "liveScenario", message }],
					});
				}
			} catch (error) {
				if (signal.aborted) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				emit({ type: "error", message, ...cell });
				emit({
					type: "cell_finished",
					...cell,
					passed: false,
					durationMs: 0,
					failures: [{ matcher: "liveScenario", message }],
				});
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		},
	};
}
