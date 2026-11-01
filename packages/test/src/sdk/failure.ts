import {
	type AgentInfrastructureError,
	type AgentInfrastructureFailure,
	isAgentInfrastructureCode,
} from "@post-print/agent-harness";

export type RecordedFailure = AgentInfrastructureFailure | { kind: "runtime"; message: string };

export function recordedFailure(error: unknown): RecordedFailure {
	if (isInfrastructureFailure(error)) {
		return {
			kind: "infrastructure",
			code: error.code,
			message: error.message,
			...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
		};
	}
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
