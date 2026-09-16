import type {
	ContextMode,
	ScenarioContextFile,
	ScenarioContextReason,
	ScenarioResult,
	SuiteRunReport,
} from "../types.js";
import type { ViewerCatalog, ViewerRunRequest } from "./catalog.js";

export interface ViewerEventEnvelope {
	suite: string;
	scenario: string;
	host: string;
	arm?: string;
}

export interface ViewerFailureEvent {
	matcher: string;
	message: string;
}

export interface ViewerJudgeVerdictEvent {
	id: string;
	question: string;
	pass: boolean;
	rationale: string;
	evidence?: string[];
}

export type ViewerContextReason = ScenarioContextReason;
export type ViewerContextFile = ScenarioContextFile;

export type ViewerRunStatus = "running" | "cancelling" | "cancelled" | "completed";

export interface ViewerRunRecord {
	id: string;
	request: ViewerRunRequest;
	status: ViewerRunStatus;
	startedAt: string;
	finishedAt?: string;
	reports: SuiteRunReport[];
}

export interface ViewerBootstrap {
	catalog: ViewerCatalog;
	runs: ViewerRunRecord[];
	selectedRunId?: string;
	/** Repository/workspace root used by the live agent runner. */
	workspace?: string;
	capabilities: { canRun: boolean; defaultWorkers?: number; maxWorkers?: number };
	reportMeta?: {
		host: string;
		suitesDir: string;
		generatedAt: string;
	};
}

export type ViewerEvent =
	| { type: "run_started"; runId: string }
	| {
			type: "run_finished";
			runId: string;
			status?: "cancelled" | "completed";
			passed: number;
			failed: number;
			skipped: number;
	  }
	| ({ type: "scenario_finalizing" } & ViewerEventEnvelope)
	| ({ type: "cell_started" } & ViewerEventEnvelope)
	| ({ type: "status"; text: string } & ViewerEventEnvelope)
	| ({ type: "prompt"; text: string } & ViewerEventEnvelope)
	| ({
			type: "context";
			/** Absent means harness-preamble for pre-1.1 event producers. */
			mode?: ContextMode;
			files: ViewerContextFile[];
			/** Exact initial user input submitted through a builtin adapter. */
			hostInput?: string;
	  } & ViewerEventEnvelope)
	| ({ type: "text"; text: string } & ViewerEventEnvelope)
	| ({ type: "tool"; name: string; args?: Record<string, unknown> } & ViewerEventEnvelope)
	| ({ type: "judge_started"; id: string; question: string } & ViewerEventEnvelope)
	| ({ type: "judge_text"; id: string; question: string; text: string } & ViewerEventEnvelope)
	| ({ type: "scenario_result"; result: ScenarioResult } & ViewerEventEnvelope)
	| ({
			type: "cell_finished";
			passed: boolean;
			skipped?: boolean;
			durationMs: number;
			failures?: ViewerFailureEvent[];
			metrics?: {
				turns?: number;
				tokens?: number;
				tools?: number;
				durationMs?: number;
				passed?: boolean;
			};
	  } & ViewerEventEnvelope)
	| ({ type: "judge"; verdicts: ViewerJudgeVerdictEvent[] } & ViewerEventEnvelope)
	| ({ type: "error"; message: string } & Partial<ViewerEventEnvelope>);

const EVENT_TYPES = new Set<ViewerEvent["type"]>([
	"run_started",
	"run_finished",
	"cell_started",
	"scenario_finalizing",
	"status",
	"prompt",
	"context",
	"text",
	"tool",
	"judge_started",
	"judge_text",
	"scenario_result",
	"cell_finished",
	"judge",
	"error",
]);

/** One NDJSON object with no trailing newline. */
export function encodeViewerEvent(event: ViewerEvent): string {
	return JSON.stringify(event);
}

export function parseViewerEvent(line: string): ViewerEvent | undefined {
	const trimmed = line.trim();
	if (!trimmed) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (!isViewerEvent(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export function parseViewerEventLines(chunk: string): ViewerEvent[] {
	return chunk.split("\n").flatMap((line) => {
		const event = parseViewerEvent(line);
		return event ? [event] : [];
	});
}

function isViewerEvent(value: unknown): value is ViewerEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return typeof type === "string" && EVENT_TYPES.has(type as ViewerEvent["type"]);
}
