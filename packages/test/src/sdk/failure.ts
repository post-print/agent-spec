import type {
	AgentInfrastructureError,
	AgentInfrastructureFailure,
} from "@post-print/agent-harness";

export type RecordedFailure = AgentInfrastructureFailure | { kind: "runtime"; message: string };

export function recordedFailure(error: unknown): RecordedFailure {
	if (isInfrastructureFailure(error)) {
		return {
			kind: "infrastructure",
			code: error.code,
			message: error.message,
			timeoutMs: error.timeoutMs,
		};
	}
	return {
		kind: "runtime",
		message: error instanceof Error ? error.message : String(error),
	};
}

function isInfrastructureFailure(error: unknown): error is AgentInfrastructureError {
	if (!error || typeof error !== "object") return false;
	const value = error as Partial<AgentInfrastructureError>;
	return (
		value.kind === "infrastructure" &&
		value.code === "timeout" &&
		typeof value.message === "string" &&
		typeof value.timeoutMs === "number"
	);
}
