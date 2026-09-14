import type { AgentHost } from "@post-print/agent-harness";

import { DEFAULT_VIEWER_WORKERS, runWorkerPool } from "../worker-pool.js";
import {
	expandViewerJobs,
	type ViewerCatalog,
	type ViewerJob,
	type ViewerRunRequest,
} from "./catalog.js";
import type { ViewerEvent } from "./events.js";

export const VIEWER_MAX_PARALLEL_AGENTS = DEFAULT_VIEWER_WORKERS;

export interface ViewerRunner {
	runJob(job: ViewerJob, emit: (event: ViewerEvent) => void, signal: AbortSignal): Promise<void>;
}

export interface ViewerRunHandle {
	runId: string;
}

interface ViewerRunSession {
	runId: string;
	events: ViewerEvent[];
	listeners: Set<(event: ViewerEvent) => void>;
	abort: AbortController;
	done: Promise<void>;
}

export interface ViewerRunController {
	start(request: ViewerRunRequest): ViewerRunHandle;
	cancel(runId: string): boolean;
	history(runId: string): ViewerEvent[] | undefined;
	subscribe(runId: string, listener: (event: ViewerEvent) => void): () => void;
	activeRunId(): string | undefined;
}

export function createViewerRunController(options: {
	catalog: ViewerCatalog;
	runner: ViewerRunner;
	maxParallelAgents?: number;
}): ViewerRunController {
	const maxParallel = options.maxParallelAgents ?? VIEWER_MAX_PARALLEL_AGENTS;
	let session: ViewerRunSession | undefined;
	let lastSession: ViewerRunSession | undefined;

	const lookup = (runId: string): ViewerRunSession | undefined => {
		if (session?.runId === runId) {
			return session;
		}
		if (lastSession?.runId === runId) {
			return lastSession;
		}
		return undefined;
	};

	const emit = (target: ViewerRunSession, event: ViewerEvent): void => {
		target.events.push(event);
		for (const listener of target.listeners) {
			listener(event);
		}
	};

	return {
		activeRunId: () => session?.runId,
		start(request) {
			if (session) {
				throw new Error("A viewer run is already in progress");
			}
			const jobs = expandViewerJobs(options.catalog, request);
			if (jobs.length === 0) {
				throw new Error("No matching scenarios to run");
			}
			const runId = `run-${Date.now()}`;
			const abort = new AbortController();
			const current: ViewerRunSession = {
				runId,
				events: [],
				listeners: new Set(),
				abort,
				done: Promise.resolve(),
			};
			session = current;
			emit(current, { type: "run_started", runId });
			current.done = runJobBatches({
				jobs,
				hosts: request.hosts ?? options.catalog.defaultSelectedHosts,
				parallelHosts: request.parallelHosts === true,
				maxParallel,
				signal: abort.signal,
				runner: options.runner,
				forward: (event) => emit(current, event),
			})
				.catch((error) => {
					emit(current, {
						type: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				})
				.finally(() => {
					const finished = summarizeFinished(current.events);
					emit(current, { type: "run_finished", runId, ...finished });
					if (session === current) {
						lastSession = current;
						session = undefined;
					}
				});
			return { runId };
		},
		cancel(runId) {
			const target = lookup(runId);
			if (!target) {
				return false;
			}
			target.abort.abort();
			return true;
		},
		history(runId) {
			const target = lookup(runId);
			return target ? [...target.events] : undefined;
		},
		subscribe(runId, listener) {
			const target = lookup(runId);
			if (!target) {
				return () => undefined;
			}
			target.listeners.add(listener);
			return () => {
				target.listeners.delete(listener);
			};
		},
	};
}

function summarizeFinished(events: ViewerEvent[]): {
	passed: number;
	failed: number;
	skipped: number;
} {
	let passed = 0;
	let failed = 0;
	let skipped = 0;
	for (const event of events) {
		if (event.type !== "cell_finished") {
			continue;
		}
		if (event.skipped) {
			skipped += 1;
		} else if (event.passed) {
			passed += 1;
		} else {
			failed += 1;
		}
	}
	return { passed, failed, skipped };
}

async function runJobBatches(options: {
	jobs: ViewerJob[];
	hosts: AgentHost[];
	parallelHosts: boolean;
	maxParallel: number;
	signal: AbortSignal;
	runner: ViewerRunner;
	forward: (event: ViewerEvent) => void;
}): Promise<void> {
	const batches = options.parallelHosts
		? [options.jobs]
		: options.hosts
				.map((host) => options.jobs.filter((job) => job.host === host))
				.filter((group) => group.length > 0);
	for (const batch of batches) {
		if (options.signal.aborted) {
			return;
		}
		await runWorkerPool(
			batch,
			options.maxParallel,
			async (job) => {
				await options.runner.runJob(job, options.forward, options.signal);
			},
			options.signal,
		);
	}
}
