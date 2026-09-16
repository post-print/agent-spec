import type { HostAuthMode } from "@post-print/agent-harness";

import { missingAgentAuth } from "../doctor.js";
import {
	killActiveLiveChildren,
	type SpawnLiveScenarioOptions,
	type SpawnLiveScenarioResult,
	spawnLiveScenario,
	subprocessFailureMessage,
} from "../live-isolation.js";
import {
	createLiveStagingSessionId,
	getStagingResultPath,
	loadStagingResult,
} from "../record-trace.js";
import { finalizeScheduledCompareScenario, finalizeScheduledScenario } from "../run-suite.js";
import type { ViewerJob } from "./catalog.js";
import type { ViewerEvent, ViewerEventEnvelope } from "./events.js";
import type { ViewerRunner } from "./run-controller.js";

export interface LiveViewerRunnerOptions {
	/** CLI entrypoint to use for isolated children when the viewer runs in a detached server. */
	cliPath?: string;
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
	judge?: boolean;
	timeoutMs?: number;
	authMode?: HostAuthMode;
	adapterModules?: string[];
	worktree?: boolean;
	keepRecordings?: boolean;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
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
		finalizeScenario: (input, emit) =>
			finalizeScheduledScenario({
				...input,
				cwd: options.cwd,
				judge: options.judge,
				onJudgeEvent: (event) => {
					const cell = { suite: input.suite, scenario: input.scenario.name, host: input.host };
					if (event.type === "criterion_started") {
						emit({ type: "judge_started", ...cell, id: event.id, question: event.question });
					} else if (event.type === "text") {
						emit({
							type: "judge_text",
							...cell,
							id: event.id,
							question: event.question,
							text: event.text,
						});
					} else {
						emit({
							type: "judge",
							...cell,
							verdicts: [
								{
									id: event.verdict.id,
									question: event.question,
									pass: event.verdict.pass,
									rationale: event.verdict.rationale,
									evidence: event.verdict.evidence,
								},
							],
						});
					}
				},
			}),
		finalizeCompare: (input) =>
			finalizeScheduledCompareScenario({
				...input,
				cwd: options.cwd,
				judge: options.judge,
			}),
		async runJob(job, emit, signal) {
			const cell = envelope(job);
			const emitFailure = (message: string): void => {
				emit({ type: "error", message, ...cell });
				emit({
					type: "cell_finished",
					...cell,
					passed: false,
					durationMs: 0,
					failures: [{ matcher: "liveScenario", message }],
				});
				emit({
					type: "scenario_result",
					...cell,
					result: {
						suite: job.suite,
						scenario: job.scenario,
						prompt: job.prompt,
						passed: false,
						durationMs: 0,
						failures: [{ matcher: "liveScenario", message, category: "agent_runtime" }],
					},
				});
			};
			emit({ type: "cell_started", ...cell });
			emit({ type: "status", text: "Starting isolated child.", ...cell });
			const missing = (options.missingAuth ?? missingAgentAuth)(job.host);
			if (missing) {
				emitFailure(missing);
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
			let deferredScenarioResult: Extract<ViewerEvent, { type: "scenario_result" }> | undefined;
			const stagingSessionId = createLiveStagingSessionId();
			try {
				const result = await spawn({
					cliPath: options.cliPath,
					cwd: options.cwd,
					suiteName: job.suite,
					scenarioName: job.scenario,
					suitesDir: options.suitesDir,
					rubricsDir: options.rubricsDir,
					suiteFilter: job.suite,
					host: job.host,
					compareArm: job.arm,
					stagingSessionId,
					judge: job.arm ? false : options.judge,
					timeoutMs: options.timeoutMs,
					noTimeout: options.timeoutMs === 0,
					authMode: options.authMode,
					adapterModules: options.adapterModules,
					worktree: options.worktree,
					keepRecordings: options.keepRecordings,
					allowUserInput: options.allowUserInput,
					debug: options.debug,
					debugDir: options.debugDir,
					signal,
					onViewerEvent: (event: ViewerEvent) => {
						if (event.type === "cell_finished") {
							finished = true;
						}
						if (job.arm && event.type === "scenario_result") {
							deferredScenarioResult = event;
							return;
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
				if (job.arm && deferredScenarioResult) {
					const sidecar = await loadStagingResult(
						getStagingResultPath(stagingSessionId, job.suite, job.scenario, job.arm),
					);
					if (sidecar?.judgeWorkspace) {
						Object.defineProperty(deferredScenarioResult.result, "judgeWorkspace", {
							value: sidecar.judgeWorkspace,
							enumerable: false,
						});
					}
					emit(deferredScenarioResult);
				}
				if (!finished && result.exitCode !== 0) {
					const message = subprocessFailureMessage(result.exitCode, result.stderr);
					emitFailure(message);
				}
			} catch (error) {
				if (signal.aborted) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				emitFailure(message);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		},
	};
}
