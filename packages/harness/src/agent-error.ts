import type { AgentTrace } from "./types.js";

const AGENT_INFRASTRUCTURE_CODES = [
	"timeout",
	"auth",
	"binary_missing",
	"host_exit",
	"worker_crash",
	"capture_incomplete",
	"provider_unavailable",
	"judge_failed",
] as const;
export type AgentInfrastructureCode = (typeof AGENT_INFRASTRUCTURE_CODES)[number];

export function isAgentInfrastructureCode(value: unknown): value is AgentInfrastructureCode {
	return AGENT_INFRASTRUCTURE_CODES.includes(value as AgentInfrastructureCode);
}

export interface AgentInfrastructureFailure {
	kind: "infrastructure";
	code: AgentInfrastructureCode;
	message: string;
	timeoutMs?: number;
}

/** A host or transport failure rather than an assertion about agent behavior. */
export class AgentInfrastructureError extends Error {
	readonly kind = "infrastructure" as const;
	constructor(
		message: string,
		readonly code: AgentInfrastructureCode,
		readonly timeoutMs?: number,
	) {
		super(message);
		this.name = "AgentInfrastructureError";
	}

	toJSON(): AgentInfrastructureFailure {
		return {
			kind: this.kind,
			code: this.code,
			message: this.message,
			...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
		};
	}
}

/**
 * The test ended or was stopped while this session ran. It is not an infrastructure failure, because
 * a test that already failed a check still failed it. Alone, it leaves that test with no verdict.
 */
export class AgentSessionCancelledError extends Error {
	constructor() {
		super("Agent session cancelled");
		this.name = "AgentSessionCancelledError";
	}
}

/**
 * The host ran and reported its own terminal failure, such as running out of turns. That is
 * something the agent did, so it is charged to the agent, unlike an error nobody typed.
 */
export class AgentOutcomeError extends Error {
	readonly kind = "agent-outcome" as const;
	constructor(message: string) {
		super(message);
		this.name = "AgentOutcomeError";
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
