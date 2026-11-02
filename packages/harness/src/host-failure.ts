import { spawn } from "node:child_process";

import { type AgentInfrastructureCode, AgentInfrastructureError } from "./agent-error.js";
import type { AgentTrace } from "./types.js";

/** Raw status of a host that exited 0 without its terminal event: the run cannot be trusted. */
export const CAPTURE_INCOMPLETE = "capture_incomplete";

const STDERR_TAIL_CHARACTERS = 240;

/**
 * Host wording, anchored to the start of a line so that text quoting an error does not match.
 * Strings are from Claude Code 2.1.300 and Codex CLI 0.154.0; the HTTP forms are the shapes they
 * format statuses in.
 */
const HOST_PREFIX = String.raw`^\s*(?:(?:error|fatal)\s*:\s*)?`;
const STATUS_PREFIX =
	"(?:api error: |unexpected status |exceeded retry limit, last status: |http |status:? )";
const AUTH_SIGNAL = new RegExp(
	`${HOST_PREFIX}(?:not logged in|please run /login|invalid (?:x-)?api[- ]key|invalid user api key|invalid auth token|missing api key|authentication[_ ](?:failed|error|required)|failed to authenticate|unauthorized\\b|unauthenticated\\b|plan_required|your access token could not be refreshed|${STATUS_PREFIX}40[13]\\b|40[13] (?:unauthorized|forbidden)\\b)`,
	"i",
);
const PROVIDER_SIGNAL = new RegExp(
	`${HOST_PREFIX}(?:${STATUS_PREFIX}(?:429|5\\d\\d)\\b|429 too many requests\\b|5\\d\\d (?:overloaded|internal|bad gateway|service unavailable|gateway)|repeated 529|overloaded|rate[ _-]?limit|resource_exhausted\\b|too many requests\\b|service unavailable\\b|you've hit your (?:usage )?limit|selected model is at capacity|quota exceeded|stream disconnected before completion)`,
	"i",
);

/** Bounded so that a long hyphenated run of text cannot cost quadratic time. */
const SECRET_NAME = String.raw`[\w-]{0,40}(?:api[-_]?key|(?:auth|access|private|secret|signing|session|ssh|encryption)[-_]?key|[-_]key|token(?!s|iz)|secret|passw(?:or)?d|passphrase|credentials?|authorization)[\w-]{0,40}`;
const SECRET_FIELD_NAME = new RegExp(`^${SECRET_NAME}$`, "i");
/** A count or flag named like a secret, such as `max_tokens=100`, is not one. */
const NOT_A_PLAIN_VALUE = String.raw`(?!(?:\d+(?:\.\d+)?|true|false|null)(?:[\s,}\]]|$))`;
const SECRET_ASSIGNMENT = new RegExp(
	String.raw`\b(${SECRET_NAME}|key(?=\s*=))(\\?['"])?\s*[=:]\s*(\\"[^"\\]*\\"|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|${NOT_A_PLAIN_VALUE}(?:(?:Basic|Bearer|Token)\s+)?\S+)`,
	"gi",
);
const PASSWORD_LINE = /\b([\w-]{0,40}(?:passw(?:or)?d|passphrase))\s*[=:]\s*(?!\\?["'])[^\n]*/gi;
const TOKEN_SHAPES = [
	/\bsk-[A-Za-z0-9_-]{6,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{16,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{16,}/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	/\bxox[abeoprs]-[A-Za-z0-9-]{8,}/g,
	/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g,
];
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]{0,20}:\/\/[^\s/:@]{0,256}:)[^\s/@]{1,2048}@/gi;

export interface HostRunResult {
	status: string;
	trace: AgentTrace;
	rawStatus?: string;
	exitCode?: number | null;
	stderr?: string;
	resultError?: string;
	sawTerminalEvent?: boolean;
	sdkError?: { message?: string; code?: string };
	/** The host said its turn succeeded, so a failed run after that is the process, not the agent. */
	hostReportedSuccess?: boolean;
	/** Set when the host's own structured signal already names the failure. */
	failureCode?: AgentInfrastructureCode;
}

function redactedAssignment(...groups: string[]): string {
	const [, name, quote = "", value = ""] = groups;
	if (quote.startsWith("\\")) return `${name}${quote}:\\"[redacted]\\"`;
	if (value.startsWith('"')) return `${name}${quote}: "[redacted]"`;
	if (value.startsWith("'")) return `${name}${quote}: '[redacted]'`;
	return `${name}${quote}=[redacted]`;
}

export function redactSecrets(text: string): string {
	const withoutShapes = TOKEN_SHAPES.reduce(
		(current, shape) => current.replace(shape, "[redacted]"),
		text,
	);
	return withoutShapes
		.replace(URL_PASSWORD, "$1[redacted]@")
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(PASSWORD_LINE, "$1=[redacted]")
		.replace(SECRET_ASSIGNMENT, redactedAssignment);
}

/** True when a structured field's name says its string value is a credential. */
export function isSecretFieldName(name: string): boolean {
	return SECRET_FIELD_NAME.test(name);
}

export function redactedTail(text: string, characters = STDERR_TAIL_CHARACTERS): string {
	return redactSecrets(text.trim()).replace(/\s+/g, " ").slice(-characters);
}

/** An HTTP status that says who failed; undefined means it may be about the request itself. */
export function codeForProviderStatus(status: number): AgentInfrastructureCode | undefined {
	if (status === 401 || status === 403) return "auth";
	if (status === 402 || status === 408 || status === 429 || status >= 500)
		return "provider_unavailable";
	return undefined;
}

function codeForHostText(text: string | undefined): AgentInfrastructureCode | undefined {
	if (!text) return undefined;
	if (AUTH_SIGNAL.test(text)) return "auth";
	return PROVIDER_SIGNAL.test(text) ? "provider_unavailable" : undefined;
}

/** Stderr can quote tool output, so it speaks only for a host that died before its terminal event. */
function codeFromStderr(result: HostRunResult): AgentInfrastructureCode | undefined {
	if (result.sawTerminalEvent !== false || result.exitCode === 0 || !result.stderr)
		return undefined;
	for (const line of result.stderr.split("\n")) {
		const code = codeForHostText(line);
		if (code) return code;
	}
	return undefined;
}

/** Each field is one message the host wrote, so only its first line is anchored against. */
function codeFromReportedFailure(result: HostRunResult): AgentInfrastructureCode | undefined {
	return (
		codeForHostText(result.sdkError?.code) ??
		codeForHostText(result.sdkError?.message) ??
		codeForHostText(result.resultError)
	);
}

/** Undefined means the host reported its own terminal failure: a real outcome, not a broken instrument. */
function infrastructureCode(result: HostRunResult): AgentInfrastructureCode | undefined {
	const signalled = result.failureCode ?? codeFromReportedFailure(result) ?? codeFromStderr(result);
	if (signalled) return signalled;
	if (result.rawStatus === CAPTURE_INCOMPLETE) return "capture_incomplete";
	if (result.sawTerminalEvent === false || result.hostReportedSuccess) return "host_exit";
	return undefined;
}

export function redactedHostResult(result: HostRunResult): HostRunResult {
	return {
		...result,
		stderr: result.stderr ? redactedTail(result.stderr) : undefined,
		resultError: result.resultError ? redactSecrets(result.resultError) : undefined,
		sdkError: result.sdkError && {
			...result.sdkError,
			message: result.sdkError.message && redactSecrets(result.sdkError.message),
		},
	};
}

export function hostRunError(message: string, result: HostRunResult): Error {
	const code = infrastructureCode(result);
	return code ? new AgentInfrastructureError(message, code) : new Error(message);
}

function errnoCode(error: unknown): string | undefined {
	const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
	return typeof code === "string" && code.startsWith("E") ? code : undefined;
}

/** An operating system error from starting or talking to the host: no run happened to judge. */
export function hostProcessFailure(error: unknown, host: string): unknown {
	const code = errnoCode(error);
	if (!code) return error;
	const detail = error instanceof Error ? error.message : code;
	return new AgentInfrastructureError(`${host} could not run: ${detail}`, "host_exit");
}

/** Node throws some spawn failures, such as E2BIG, and emits others; this covers the thrown ones. */
export function spawnHostProcess(
	host: string,
	command: [string, string[]],
	options: Parameters<typeof spawn>[2],
) {
	try {
		return spawn(command[0], command[1], options);
	} catch (error) {
		throw hostProcessFailure(error, host);
	}
}
