import type { AgentTrace } from "@post-print/agent-harness";
import type { ScenarioResult } from "../types.js";
import type { ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import type { Evaluation, Run } from "./types.js";

export interface TestEntry {
	id: string;
	title: string;
	listFile: string;
	file: string;
	project: string;
}
interface RunEvent {
	type: string;
	runId: string;
	value: unknown;
}
export interface WireEvent {
	type: string;
	tests?: TestEntry[];
	event?: RunEvent;
	passed?: boolean;
	skipped?: boolean;
	durationMs?: number;
	errors?: string[];
	message?: string;
}
function combinedTrace(runs: Run[]): AgentTrace {
	return {
		messages: runs.flatMap((run) => run.trace.messages),
		toolCalls: runs.flatMap((run) => run.toolCalls),
		shellCommands: runs.flatMap((run) => run.trace.shellCommands),
		artifacts: {},
	};
}
/** One test result owns its captured runs, checks, and independent grades. */
export class ViewerTestResult {
	private readonly runs = new Map<string, Run>();
	private readonly evaluations: Evaluation[] = [];
	private result?: ScenarioResult;
	private readonly envelope;
	constructor(
		job: ViewerJob,
		private readonly emit: (event: ViewerEvent) => void,
	) {
		this.envelope = { suite: job.suite, scenario: job.scenario, host: job.host };
	}
	start() {
		this.emit({ ...this.envelope, type: "cell_started" });
	}
	receive(wire: WireEvent) {
		if (wire.event) this.capture(wire.event);
		if (wire.type === "error")
			this.emit({ ...this.envelope, type: "status", text: wire.message ?? "Runner error" });
		if (wire.type === "result") this.result = this.completedResult(wire);
	}
	private capture(event: RunEvent) {
		switch (event.type) {
			case "start":
				this.emit({
					...this.envelope,
					type: "prompt",
					text: (event.value as { prompt: string }).prompt,
				});
				break;
			case "agent":
				this.agentEvent(event.value);
				break;
			case "complete":
				this.runs.set(event.runId, event.value as Run);
				break;
			case "evaluation":
				this.evaluations.push(event.value as Evaluation);
				break;
		}
	}
	private agentEvent(raw: unknown) {
		const value = raw as {
			type: string;
			text?: string;
			name?: string;
			args?: Record<string, unknown>;
		};
		if (value.type === "text")
			this.emit({ ...this.envelope, type: "text", text: value.text ?? "" });
		if (value.type === "tool")
			this.emit({ ...this.envelope, type: "tool", name: value.name ?? "tool", args: value.args });
	}
	private section(run: Run) {
		return {
			title: run.name,
			checks: [],
			notes: [run.output, `Agent tokens: ${run.usage.tokens.total ?? "unavailable"}`],
		};
	}
	private completedResult(wire: WireEvent): ScenarioResult {
		const all = [...this.runs.values()];
		const errors = wire.errors?.length ? wire.errors : ["Test did not pass"];
		return {
			authoring: "typescript",
			suite: this.envelope.suite,
			scenario: this.envelope.scenario,
			passed: wire.passed === true,
			skipped: wire.skipped,
			durationMs: wire.durationMs ?? 0,
			trace: combinedTrace(all),
			failures: wire.passed
				? []
				: errors.map((message) => ({ matcher: "test", message, category: "rubric_miss" })),
			story: {
				criteria: [],
				result: [],
				verdict: wire.errors ?? [],
				sections: [
					...all.map((run) => this.section(run)),
					...this.evaluations.map((value) => ({
						title: value.name,
						checks: [],
						notes: [
							JSON.stringify(value.output),
							`Judge tokens: ${value.usage.tokens.total ?? "unavailable"}`,
						],
					})),
				],
			},
		};
	}
	finish(code: number, cancelled: boolean) {
		const result = this.result ?? this.missingResult(code, cancelled);
		this.emit({ ...this.envelope, type: "scenario_result", result });
		this.emit({
			...this.envelope,
			type: "cell_finished",
			passed: result.passed,
			skipped: result.skipped,
			durationMs: result.durationMs,
			failures: result.failures,
		});
	}
	private missingResult(code: number, cancelled: boolean): ScenarioResult {
		return {
			authoring: "typescript",
			suite: this.envelope.suite,
			scenario: this.envelope.scenario,
			passed: false,
			durationMs: 0,
			failures: [
				{
					matcher: "runner",
					message: cancelled ? "Cancelled" : `Runner exited without a result (${code})`,
					category: "agent_runtime",
				},
			],
		};
	}
}
