/** Split a shell line on combinators so each statement is scored. */
const SHELL_SPLIT = /(?:&&|\|\||;|\n|(?<!\|)\|(?!\|))/;

/** Split `cmd && other` into statements. Pipes and newlines also split. */
export function splitShellSegments(command: string): string[] {
	return command
		.split(SHELL_SPLIT)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

/** True when the statement includes at least one allowlist fragment. */
export function shellSegmentAllowed(segment: string, allowlist: string[]): boolean {
	return allowlist.some((pattern) => pattern.length > 0 && segment.includes(pattern));
}

/** Segments of one command that miss the allowlist. An empty list rejects every statement. */
export function disallowedShellSegments(command: string, allowlist: string[]): string[] {
	const segments = splitShellSegments(command);
	if (segments.length === 0) {
		return [];
	}
	if (allowlist.length === 0) {
		return [command.trim() || command];
	}
	return segments.filter((segment) => !shellSegmentAllowed(segment, allowlist));
}

/** True when every statement in the command matches the allowlist. */
export function shellCommandAllowed(command: string, allowlist: string[]): boolean {
	return disallowedShellSegments(command, allowlist).length === 0;
}
