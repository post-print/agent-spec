import type { AgentTrace } from "./types.js";

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

/** The agent named paths outside its sealed workspace; its result is not trusted evidence. */
export class WorkspaceEscapeError extends Error {
	readonly kind = "workspace-escape" as const;
	constructor(
		readonly paths: string[],
		readonly trace: AgentTrace,
	) {
		super(`Agent used paths outside the isolated workspace: ${paths.join(", ")}`);
		this.name = "WorkspaceEscapeError";
	}

	toJSON(): { kind: "workspace-escape"; message: string; paths: string[] } {
		return { kind: this.kind, message: this.message, paths: this.paths };
	}
}
