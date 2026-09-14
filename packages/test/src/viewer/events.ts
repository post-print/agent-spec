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
}

export type ViewerEvent =
	| { type: "run_started"; runId: string }
	| { type: "run_finished"; runId: string; passed: number; failed: number; skipped: number }
	| ({ type: "cell_started" } & ViewerEventEnvelope)
	| ({ type: "prompt"; text: string } & ViewerEventEnvelope)
	| ({ type: "text"; text: string } & ViewerEventEnvelope)
	| ({ type: "tool"; name: string; args?: Record<string, unknown> } & ViewerEventEnvelope)
	| ({
			type: "cell_finished";
			passed: boolean;
			skipped?: boolean;
			durationMs: number;
			failures?: ViewerFailureEvent[];
	  } & ViewerEventEnvelope)
	| ({ type: "judge"; verdicts: ViewerJudgeVerdictEvent[] } & ViewerEventEnvelope)
	| ({ type: "error"; message: string } & Partial<ViewerEventEnvelope>);

const EVENT_TYPES = new Set<ViewerEvent["type"]>([
	"run_started",
	"run_finished",
	"cell_started",
	"prompt",
	"text",
	"tool",
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
