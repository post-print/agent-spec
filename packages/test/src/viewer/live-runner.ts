import type { HostAuthMode } from "@post-print/agent-harness";

import { missingAgentAuth } from "../doctor.js";
import { killActiveLiveChildren, spawnLiveScenario } from "../live-isolation.js";
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
			const missing = missingAgentAuth(job.host);
			if (missing) {
				emit({ type: "cell_started", ...cell });
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
			try {
				await spawnLiveScenario({
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
					onViewerEvent: (event: ViewerEvent) => emit(event),
				});
			} catch (error) {
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
