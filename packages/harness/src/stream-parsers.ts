import { recordUnparsedLine } from "./capture.js";
import {
	accumulateClaudeEvent,
	createClaudeTraceAccumulator,
	finalizeClaudeTraceAccumulator,
	parseClaudeNdjsonLine,
} from "./claude-capture.js";
import {
	accumulateOpenaiEvent,
	createOpenaiTraceAccumulator,
	finalizeOpenaiTraceAccumulator,
	parseOpenaiJsonlLine,
} from "./openai-capture.js";
import type { AgentTrace } from "./types.js";

/**
 * A recorded Claude Code `--output-format stream-json` transcript, as the trace a live run builds
 * from the same lines. A line that is not an event counts in `artifacts.droppedOutputLines`. It does
 * not check for escapes: pass the trace to `assertInsideWorkspace` for that.
 */
export function parseClaudeStream(text: string): AgentTrace {
	const acc = createClaudeTraceAccumulator();
	for (const line of text.split("\n")) {
		const event = parseClaudeNdjsonLine(line);
		if (event) accumulateClaudeEvent(acc, event);
		else recordUnparsedLine(acc, line);
	}
	return finalizeClaudeTraceAccumulator(acc);
}
/** A recorded Codex `exec --json` transcript, as the trace a live run builds from the same lines. */
export function parseCodexStream(text: string): AgentTrace {
	const acc = createOpenaiTraceAccumulator();
	for (const line of text.split("\n")) {
		const event = parseOpenaiJsonlLine(line);
		if (event) accumulateOpenaiEvent(acc, event);
		else recordUnparsedLine(acc, line);
	}
	return finalizeOpenaiTraceAccumulator(acc);
}
