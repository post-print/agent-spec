import type { AgentTrace } from "@post-print/agent-harness";
import type { ScenarioResult, StoryCheck } from "../types.js";
import type { ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import type { Criteria, EvidenceReference, Grade, Run } from "./types.js";

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
interface JudgedRun {
	runId: string;
	grade: Grade;
	criteria: Criteria;
}
interface CheckOutcome {
	checks: Record<string, boolean>;
	expectedFailures: string[];
}
function storyChecks(value: CheckOutcome): StoryCheck[] {
	return Object.entries(value.checks).map(([name, passed]) => {
		const expected = value.expectedFailures.includes(name);
		const suffix = expected ? (passed ? " (unexpectedly passed)" : " (failed as expected)") : "";
		return { text: name + suffix, status: passed !== expected ? "pass" : "fail" };
	});
}
function evidenceLabel(ref: EvidenceReference): string {
	if (ref.source === "transcript") return `transcript event ${ref.event}`;
	const snapshot = ref.snapshot ? `${ref.snapshot}/` : "";
	const line = ref.line ? `:${ref.line}` : "";
	return `${snapshot}${ref.path}${line}`;
}
function gradeNotes({ grade, criteria }: JudgedRun): string[] {
	return Object.entries(grade.scores).map(([key, score]) => {
		const evidence = grade.evidence[key].map(evidenceLabel).join(", ");
		return `${key}: ${score} (${criteria[key].scores[score]}) — ${grade.reasons[key]} Evidence: ${evidence}. Judge tokens: ${grade.usage.tokens.total ?? "unavailable"}`;
	});
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
	private readonly variants = new Map<string, { name: string; repetition: number }>();
	private readonly checks = new Map<string, StoryCheck[]>();
	private readonly grades: JudgedRun[] = [];
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
			case "checks":
				this.checks.set(event.runId, storyChecks(event.value as CheckOutcome));
				break;
			case "complete":
				this.runs.set(event.runId, event.value as Run);
				break;
			case "variant":
				this.variants.set(event.runId, event.value as { name: string; repetition: number });
				break;
			case "grade":
				this.grades.push({
					runId: event.runId,
					...(event.value as { grade: Grade; criteria: Criteria }),
				});
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
		const variant = this.variants.get(run.id);
		return {
			title: variant ? `${variant.name} · run ${variant.repetition + 1}` : "Agent run",
			checks: this.checks.get(run.id) ?? [],
			notes: [
				run.output,
				`Agent tokens: ${run.usage.tokens.total ?? "unavailable"}`,
				...this.grades.filter((grade) => grade.runId === run.id).flatMap(gradeNotes),
			],
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
				sections: all.map((run) => this.section(run)),
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
