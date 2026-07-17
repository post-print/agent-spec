import { captureGitDiff, enrichTrace } from "../capture.js";
import { formatCursorRunFailure, runCursorAgent, takeLastCursorRunTrace } from "../cursor-run.js";
import { buildRoutingContract } from "../routing-contract.js";
import { getPartialTrace } from "../run-guards.js";
import type { AgentSession, AgentTrace, HostAdapter, RunAgentOptions } from "../types.js";
import { ReplayAdapter } from "./replay.js";

function emptyFailed(host: "cursor" | "claude", error: string): AgentSession {
	return {
		host,
		status: "failed",
		trace: { messages: [], toolCalls: [], shellCommands: [], artifacts: {} },
		durationMs: 0,
		error,
	};
}

function sessionFromTrace(
	host: "cursor" | "claude",
	trace: AgentTrace,
	error: string,
	durationMs: number,
): AgentSession {
	return {
		host,
		status: "failed",
		trace: enrichTrace(trace),
		durationMs,
		error,
	};
}

/** Cursor SDK adapter — requires optional @cursor/sdk peer + CURSOR_API_KEY. */
export class CursorAdapter implements HostAdapter {
	readonly host = "cursor" as const;

	async run(options: RunAgentOptions): Promise<AgentSession> {
		if (!process.env.CURSOR_API_KEY) {
			return emptyFailed(
				this.host,
				"CURSOR_API_KEY not set — use host replay or set API key for live runs",
			);
		}

		const started = performance.now();
		try {
			const contract = options.outputContract
				? `\n\n${buildRoutingContract(options.outputContract)}\n`
				: "";
			const prompt = `${options.context.preamble}\n\n---\n${contract}Task:\n${options.prompt}`;

			const {
				trace: streamedTrace,
				status,
				rawStatus,
				sdkError,
			} = await runCursorAgent({
				cwd: options.cwd,
				prompt,
				mcpServers: options.mcpServers,
				timeoutMs: options.timeoutMs,
				failOnUserInput: options.failOnUserInput,
				onDeadlineStart: options.onDeadlineStart,
			});
			const gitDiffResult = await captureGitDiff(options.cwd);
			const trace = enrichTrace({
				...streamedTrace,
				gitDiff: gitDiffResult.diff,
				artifacts: {
					...streamedTrace.artifacts,
					...(gitDiffResult.truncated ? { gitDiffTruncated: "true" } : {}),
					...(rawStatus ? { cursorRawStatus: rawStatus } : {}),
					...(sdkError?.code ? { cursorSdkErrorCode: sdkError.code } : {}),
					...(sdkError?.message ? { cursorSdkErrorMessage: sdkError.message } : {}),
				},
			});

			const durationMs = Math.round(performance.now() - started);
			if (status === "completed") {
				return {
					host: this.host,
					status: "completed",
					trace,
					durationMs,
				};
			}

			return {
				host: this.host,
				status: "failed",
				trace,
				durationMs,
				error: formatCursorRunFailure({ status, rawStatus, sdkError }),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to load or run @cursor/sdk";
			const durationMs = Math.round(performance.now() - started);
			const partial = getPartialTrace(error) ?? takeLastCursorRunTrace();
			if (
				message.includes("Cannot find package '@cursor/sdk'") ||
				message.includes("@cursor/sdk")
			) {
				return emptyFailed(
					this.host,
					"Install @cursor/sdk for live runs: npm i -D @cursor/sdk (peer dependency)",
				);
			}
			if (partial && (partial.messages.length > 0 || partial.toolCalls.length > 0)) {
				return sessionFromTrace(this.host, partial, message, durationMs);
			}
			return emptyFailed(this.host, message);
		}
	}
}

/** Claude Code CLI adapter — stub until structured headless output is wired. */
export class ClaudeAdapter implements HostAdapter {
	readonly host = "claude" as const;

	async run(_options: RunAgentOptions): Promise<AgentSession> {
		return emptyFailed(
			this.host,
			"Claude Code adapter not implemented — use host replay or export session to trace JSON",
		);
	}
}

export function createAdapter(host: RunAgentOptions["host"]): HostAdapter {
	switch (host) {
		case "cursor":
			return new CursorAdapter();
		case "claude":
			return new ClaudeAdapter();
		default:
			return new ReplayAdapter();
	}
}

export { ReplayAdapter };
