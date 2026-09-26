export type AgentInfrastructureCode = "timeout";

export interface AgentInfrastructureFailure {
	kind: "infrastructure";
	code: AgentInfrastructureCode;
	message: string;
	timeoutMs: number;
}

/** A host or transport failure rather than an assertion about agent behavior. */
export class AgentInfrastructureError extends Error {
	readonly kind = "infrastructure" as const;
	constructor(
		message: string,
		readonly code: AgentInfrastructureCode,
		readonly timeoutMs: number,
	) {
		super(message);
		this.name = "AgentInfrastructureError";
	}

	toJSON(): AgentInfrastructureFailure {
		return {
			kind: this.kind,
			code: this.code,
			message: this.message,
			timeoutMs: this.timeoutMs,
		};
	}
}
