import type { ContextMode } from "../../src/types.js";
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
	| { type: "context"; mode?: ContextMode; files: ViewerContextFile[]; hostInput?: string }
	| { type: "prompt"; text?: string }
	| { type: "text"; text: string }
	| { type: "tool"; name: string; args?: Record<string, unknown> }
	| { type: "error"; message: string }
	| { type: "sleep"; ms: number }
	| { type: "wait"; gate: string }
	| { type: "throw"; message: string }
	| { type: "judge_started"; id: string; question: string }
	| { type: "judge_text"; id: string; question: string; text: string }
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

interface ScriptedRunnerOptions {
	scripts?: Record<string, ScriptedStep[]>;
	defaultSteps?: ScriptedStep[];
	gates?: GateBox;
	onJob?: (job: ViewerJob) => void;
}
export function createScriptedRunner(options: ScriptedRunnerOptions): ViewerRunner {
	const gates = options.gates ?? createGateBox();
	const fallback = options.defaultSteps ?? defaultPassSteps();
	return {
		async runJob(job, emit, signal) {
			options.onJob?.(job);
			await new ScriptedJob(job, emit).run(options.scripts?.[jobKey(job)] ?? fallback, {
				gates,
				signal,
			});
		},
	};
}

class ScriptedJob {
	private readonly judgeVerdicts: ViewerJudgeVerdictEvent[] = [];
	private readonly messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
	private readonly toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
	private finished: Extract<ViewerEvent, { type: "cell_finished" }> | undefined;
	private continuingAssistant = false;
	private readonly cell;
	constructor(
		private readonly job: ViewerJob,
		private readonly emit: (event: ViewerEvent) => void,
	) {
		this.cell = {
			suite: job.suite,
			scenario: job.scenario,
			host: job.host,
			...(job.arm ? { arm: job.arm } : {}),
		};
	}
	async run(steps: ScriptedStep[], { gates, signal }: { gates: GateBox; signal: AbortSignal }) {
		this.emit({ type: "cell_started", ...this.cell });
		for (const step of steps) {
			if (signal.aborted) return;
			if (step.type === "wait") await abortable(gates.wait(step.gate), signal);
			else if (step.type === "sleep") await abortable(sleep(step.ms), signal);
			else this.apply(step);
		}
		this.publishResult();
	}

	status(step: Extract<ScriptedStep, { type: "status" }>) {
		this.emit({ type: "status", text: step.text, ...this.cell });
	}

	context(step: Extract<ScriptedStep, { type: "context" }>) {
		this.emit({
			type: "context",
			mode: step.mode ?? "harness-preamble",
			files: step.files,
			hostInput: step.hostInput,
			...this.cell,
		});
	}

	prompt(step: Extract<ScriptedStep, { type: "prompt" }>) {
		const text = step.text ?? this.job.prompt;
		this.messages.push({ role: "user", content: text });
		this.continuingAssistant = false;
		this.emit({ type: "prompt", text, ...this.cell });
	}

	text(step: Extract<ScriptedStep, { type: "text" }>) {
		if (this.continuingAssistant && this.messages.at(-1)?.role === "assistant") {
			(this.messages.at(-1) as { role: "assistant"; content: string }).content = step.text;
		} else {
			this.messages.push({ role: "assistant", content: step.text });
		}
		this.continuingAssistant = true;
		this.emit({ type: "text", text: step.text, ...this.cell });
	}

	tool(step: Extract<ScriptedStep, { type: "tool" }>) {
		this.toolCalls.push({ name: step.name, ...(step.args ? { args: step.args } : {}) });
		this.continuingAssistant = false;
		this.emit({ type: "tool", name: step.name, args: step.args, ...this.cell });
	}

	error(step: Extract<ScriptedStep, { type: "error" }>) {
		this.messages.push({ role: "system", content: step.message });
		this.continuingAssistant = false;
		this.emit({ type: "error", message: step.message, ...this.cell });
	}

	judge(step: Extract<ScriptedStep, { type: "judge" }>) {
		this.judgeVerdicts.push(...step.verdicts);
		this.emit({ type: "judge", verdicts: step.verdicts, ...this.cell });
	}

	judge_started(step: Extract<ScriptedStep, { type: "judge_started" }>) {
		this.emit({ type: "judge_started", id: step.id, question: step.question, ...this.cell });
	}

	judge_text(step: Extract<ScriptedStep, { type: "judge_text" }>) {
		this.emit({
			type: "judge_text",
			id: step.id,
			question: step.question,
			text: step.text,
			...this.cell,
		});
	}

	throw(step: Extract<ScriptedStep, { type: "throw" }>) {
		throw new Error(step.message);
	}

	finish(step: Extract<ScriptedStep, { type: "finish" }>) {
		this.finished = {
			type: "cell_finished",
			...this.cell,
			passed: step.passed ?? !step.skipped,
			durationMs: step.durationMs ?? 4,
		};
		if (step.skipped) {
			this.finished.skipped = true;
		}
		if (step.metrics) {
			this.finished.metrics = step.metrics;
		}
		if (step.failures) {
			this.finished.failures = step.failures;
		}
		this.emit(this.finished);
	}

	apply(step: Exclude<ScriptedStep, { type: "wait" | "sleep" }>) {
		switch (step.type) {
			case "status":
				this.status(step);
				return;
			case "context":
				this.context(step);
				return;
			case "prompt":
				this.prompt(step);
				return;
			case "text":
				this.text(step);
				return;
			case "tool":
				this.tool(step);
				return;
			case "error":
				this.error(step);
				return;
			case "judge":
				this.judge(step);
				return;
			case "judge_started":
				this.judge_started(step);
				return;
			case "judge_text":
				this.judge_text(step);
				return;
			case "throw":
				this.throw(step);
				return;
			case "finish":
				this.finish(step);
				return;
		}
	}

	publishResult() {
		if (this.finished) {
			const metrics = this.finished.metrics;
			while (
				this.messages.filter((message) => message.role === "assistant").length <
				(metrics?.turns ?? 0)
			) {
				this.messages.push({ role: "assistant", content: "" });
			}
			while (this.toolCalls.length < (metrics?.tools ?? 0))
				this.toolCalls.push({ name: "ScriptedTool" });
			this.emit({
				type: "scenario_result",
				...this.cell,
				result: {
					suite: this.job.suite,
					scenario: this.job.scenario,
					prompt: this.job.prompt,
					passed: this.finished.passed,
					skipped: this.finished.skipped,
					failures: this.finished.failures ?? [],
					durationMs: this.finished.durationMs,
					judgeVerdicts: this.judgeVerdicts,
					trace: {
						messages: this.messages,
						toolCalls: this.toolCalls,
						shellCommands: [],
						artifacts: {},
						...(metrics?.tokens === undefined ? {} : { usage: { totalTokens: metrics.tokens } }),
					},
				},
			});
		}
	}
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
