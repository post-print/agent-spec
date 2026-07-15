import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentSession, AgentTrace, HostAdapter, RunAgentOptions } from "../types.js";

function emptyTrace(): AgentTrace {
	return {
		messages: [],
		toolCalls: [],
		shellCommands: [],
		artifacts: {},
	};
}

function isAgentTrace(value: unknown): value is AgentTrace {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const trace = value as AgentTrace;
	return (
		Array.isArray(trace.messages) &&
		Array.isArray(trace.toolCalls) &&
		Array.isArray(trace.shellCommands) &&
		typeof trace.artifacts === "object" &&
		trace.artifacts !== null &&
		!Array.isArray(trace.artifacts)
	);
}

function failedReplay(started: number, error: string): AgentSession {
	return {
		host: "replay",
		status: "failed",
		trace: emptyTrace(),
		durationMs: Math.round(performance.now() - started),
		error,
	};
}

/** Replay a committed trace JSON — host-agnostic scoring path. */
export class ReplayAdapter implements HostAdapter {
	readonly host = "replay" as const;

	async run(options: RunAgentOptions): Promise<AgentSession> {
		const started = performance.now();
		if (!options.replayTracePath) {
			return failedReplay(started, "replay host requires replayTracePath");
		}

		const path = resolve(options.cwd, options.replayTracePath);
		let parsed: unknown;
		try {
			const raw = await readFile(path, "utf8");
			parsed = JSON.parse(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read replay trace";
			return failedReplay(started, `invalid replay trace: ${message}`);
		}

		if (!isAgentTrace(parsed)) {
			return failedReplay(
				started,
				"invalid replay trace: expected messages, toolCalls, shellCommands, and artifacts",
			);
		}

		return {
			host: this.host,
			status: "completed",
			trace: { ...parsed, raw: parsed },
			durationMs: Math.round(performance.now() - started),
		};
	}
}
