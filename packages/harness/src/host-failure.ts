import { type AgentInfrastructureCode, AgentInfrastructureError } from "./agent-error.js";
import type { AgentTrace } from "./types.js";

/** Raw status of a host that exited 0 without its terminal event: the run cannot be trusted. */
export const CAPTURE_INCOMPLETE = "capture_incomplete";

const STDERR_TAIL_CHARACTERS = 240;
const AUTH_FAILURE =
	/not logged in|please run \/login|invalid (x-)?api[- ]key|missing api key|api[- ]key requires|unauthorized|authentication[_ ](failed|error)|agent-test login|codex login/i;

export interface HostRunResult {
	status: string;
	trace: AgentTrace;
	rawStatus?: string;
	exitCode?: number | null;
	stderr?: string;
	resultError?: string;
	sawTerminalEvent?: boolean;
	sdkError?: { message?: string; code?: string };
}

export function redactSecrets(text: string): string {
	return text
		.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[redacted]")
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\b(\w*(?:key|token|secret|password)\w*)\s*[=:]\s*\S+/gi, "$1=[redacted]");
}

export function redactedTail(text: string, characters = STDERR_TAIL_CHARACTERS): string {
	return redactSecrets(text.trim().replace(/\s+/g, " ")).slice(-characters);
}

export function isAuthFailure(text: string): boolean {
	return AUTH_FAILURE.test(text);
}

function failureText(result: HostRunResult): string {
	return [result.resultError, result.stderr, result.sdkError?.message].filter(Boolean).join("\n");
}

/** Undefined means the host reported its own terminal failure: a real outcome, not a broken instrument. */
function infrastructureCode(result: HostRunResult): AgentInfrastructureCode | undefined {
	if (isAuthFailure(failureText(result))) return "auth";
	if (result.rawStatus === CAPTURE_INCOMPLETE) return "capture_incomplete";
	return result.sawTerminalEvent === false ? "host_exit" : undefined;
}

export function redactedHostResult(result: HostRunResult): HostRunResult {
	return {
		...result,
		stderr: result.stderr ? redactedTail(result.stderr) : undefined,
		resultError: result.resultError ? redactSecrets(result.resultError) : undefined,
	};
}

export function hostRunError(message: string, result: HostRunResult): Error {
	const code = infrastructureCode(result);
	return code ? new AgentInfrastructureError(message, code) : new Error(message);
}
