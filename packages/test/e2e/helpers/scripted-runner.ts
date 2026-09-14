import type { ViewerJob } from "../../src/viewer/catalog.js";
import type {
	ViewerContextFile,
	ViewerEvent,
	ViewerFailureEvent,
	ViewerJudgeVerdictEvent,
} from "../../src/viewer/events.js";
import type { ViewerRunner } from "../../src/viewer/run-controller.js";

export type ScriptedStep =
	| { type: "status"; text: string }
	| { type: "context"; files: ViewerContextFile[] }
	| { type: "prompt"; text?: string }
	| { type: "text"; text: string }
	| { type: "tool"; name: string; args?: Record<string, unknown> }
	| { type: "error"; message: string }
	| { type: "sleep"; ms: number }
	| { type: "wait"; gate: string }
	| { type: "throw"; message: string }
	| { type: "judge"; verdicts: ViewerJudgeVerdictEvent[] }
	| {
			type: "finish";
			passed?: boolean;
			skipped?: boolean;
			durationMs?: number;
			failures?: ViewerFailureEvent[];
			metrics?: { turns?: number; tokens?: number; tools?: number };
	  };

export interface GateBox {
	wait: (name: string) => Promise<void>;
	release: (name: string) => void;
}

export function createGateBox(): GateBox {
	const pending = new Map<string, { promise: Promise<void>; resolve: () => void }>();
	const ensure = (name: string) => {
		const existing = pending.get(name);
		if (existing) {
			return existing;
		}
		let resolve = (): void => undefined;
		const promise = new Promise<void>((done) => {
			resolve = done;
		});
		const created = { promise, resolve };
		pending.set(name, created);
		return created;
	};
	return {
		wait: (name) => ensure(name).promise,
		release: (name) => {
			ensure(name).resolve();
		},
	};
}

export function jobKey(job: ViewerJob): string {
	return `${job.suite}::${job.scenario}::${job.host}::${job.arm ?? "_"}`;
}

export function defaultPassSteps(): ScriptedStep[] {
	return [
		{ type: "status", text: "Starting isolated child." },
		{ type: "prompt" },
		{ type: "text", text: "ok" },
		{ type: "finish", passed: true, durationMs: 8, metrics: { turns: 1, tokens: 20, tools: 0 } },
	];
}

export function createScriptedRunner(options: {
	scripts?: Record<string, ScriptedStep[]>;
	defaultSteps?: ScriptedStep[];
	gates?: GateBox;
	onJob?: (job: ViewerJob) => void;
}): ViewerRunner {
	const scripts = options.scripts ?? {};
	const fallback = options.defaultSteps ?? defaultPassSteps();
	const gates = options.gates ?? createGateBox();
	return {
		async runJob(job, emit, signal) {
			options.onJob?.(job);
			const cell = {
				suite: job.suite,
				scenario: job.scenario,
				host: job.host,
				...(job.arm ? { arm: job.arm } : {}),
			};
			emit({ type: "cell_started", ...cell });
			const steps = scripts[jobKey(job)] ?? fallback;
			for (const step of steps) {
				if (signal.aborted) {
					return;
				}
				if (step.type === "wait") {
					await abortable(gates.wait(step.gate), signal);
					continue;
				}
				if (step.type === "sleep") {
					await abortable(sleep(step.ms), signal);
					continue;
				}
				if (step.type === "status") {
					emit({ type: "status", text: step.text, ...cell });
					continue;
				}
				if (step.type === "context") {
					emit({ type: "context", files: step.files, ...cell });
					continue;
				}
				if (step.type === "prompt") {
					emit({ type: "prompt", text: step.text ?? job.prompt, ...cell });
					continue;
				}
				if (step.type === "text") {
					emit({ type: "text", text: step.text, ...cell });
					continue;
				}
				if (step.type === "tool") {
					emit({ type: "tool", name: step.name, args: step.args, ...cell });
					continue;
				}
				if (step.type === "error") {
					emit({ type: "error", message: step.message, ...cell });
					continue;
				}
				if (step.type === "judge") {
					emit({ type: "judge", verdicts: step.verdicts, ...cell });
					continue;
				}
				if (step.type === "throw") {
					throw new Error(step.message);
				}
				const finished: ViewerEvent = {
					type: "cell_finished",
					...cell,
					passed: step.passed ?? !step.skipped,
					durationMs: step.durationMs ?? 4,
				};
				if (step.skipped) {
					finished.skipped = true;
				}
				if (step.metrics) {
					finished.metrics = step.metrics;
				}
				if (step.failures) {
					finished.failures = step.failures;
				}
				emit(finished);
			}
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const onAbort = (): void => resolve();
		signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}
