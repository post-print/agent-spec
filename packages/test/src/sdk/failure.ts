import {
	type AgentInfrastructureError,
	type AgentInfrastructureFailure,
	AgentOutcomeError,
	isAgentInfrastructureCode,
	WorkspaceEscapeError,
} from "@post-print/agent-harness";

/**
 * Who caused an operation's failure, as far as typed evidence shows. "agent" is the agent's own
 * outcome; "runtime" is an error nobody typed, which says nothing about the agent.
 */
export type RecordedFailure =
	| AgentInfrastructureFailure
	| { kind: "agent"; message: string }
	| { kind: "runtime"; message: string };

/** The host reported the agent's own terminal failure, or the agent left its workspace. */
function causedByAgent(error: unknown): error is Error {
	return error instanceof AgentOutcomeError || error instanceof WorkspaceEscapeError;
}

export function recordedFailure(error: unknown): RecordedFailure {
	if (isInfrastructureFailure(error)) {
		return {
			kind: "infrastructure",
			code: error.code,
			message: error.message,
			...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
		};
	}
	if (causedByAgent(error)) return { kind: "agent", message: error.message };
	return {
		kind: "runtime",
		message: error instanceof Error ? error.message : String(error),
	};
}

export function isInfrastructureFailure(error: unknown): error is AgentInfrastructureError {
	if (!error || typeof error !== "object") return false;
	const value = error as Partial<AgentInfrastructureError>;
	return (
		value.kind === "infrastructure" &&
		isAgentInfrastructureCode(value.code) &&
		typeof value.message === "string"
	);
}
