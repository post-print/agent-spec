import { captureGitDiff, enrichTrace } from "../capture.js";
import { runCursorAgent } from "../cursor-run.js";
import { buildRoutingContract } from "../routing-contract.js";
import type { AgentSession, HostAdapter, RunAgentOptions } from "../types.js";
import { ReplayAdapter } from "./replay.js";

function emptyFailed(host: "cursor" | "claude", error: string): AgentSession {
	return {
		host,
		status: "skipped",
		trace: { messages: [], toolCalls: [], shellCommands: [], artifacts: {} },
		durationMs: 0,
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

		try {
			const started = performance.now();
			const contract = options.outputContract
				? `\n\n${buildRoutingContract(options.outputContract)}\n`
				: "";
			const prompt = `${options.context.preamble}\n\n---\n${contract}Task:\n${options.prompt}`;

			const { trace: streamedTrace, status } = await runCursorAgent({
				cwd: options.cwd,
				prompt,
			});
			const gitDiff = await captureGitDiff(options.cwd);
			const trace = enrichTrace({ ...streamedTrace, gitDiff });

			return {
				host: this.host,
				status: status === "completed" ? "completed" : "failed",
				trace,
				durationMs: Math.round(performance.now() - started),
				error: status !== "completed" ? `cursor run status: ${status}` : undefined,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to load or run @cursor/sdk";
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
