const SHELL_WRAPPER = /\s-(?:lc|c)\s+(["'])([\s\S]*)\1\s*$/;
const SEGMENT_SEPARATOR = /(&&|\|\||[;|\n])/;
/** A heredoc body: file content written by the command, not paths it names. */
const HEREDOC =
	/<<-?\s*(["']?)(?<tag>\w+)\1(?<rest>[^\n]*)\n[\s\S]*?\n[ \t]*\k<tag>[ \t]*(?=\n|$)/g;
const TOKEN_SEPARATORS = /[\s"']+/;
const REDIRECTION_PREFIX = /^\d*[<>]+&?/;
const OPTION_VALUE = /^--?[\w-]+=(.+)$/;
/** Backslashes left on a token by an escaped quote, as in `node -e "import(\"../x.mjs\")"`. */
const ESCAPE_TAIL = /\\+$/;

/** One simple command inside a shell payload, with the operator that follows it. */
export interface ShellSegment {
	tokens: string[];
	/** Operator after this segment, or undefined for the final segment. */
	next?: "&&" | "||" | ";" | "|";
}

/** The script inside `/bin/zsh -lc "…"`, or the command itself when unwrapped. */
export function shellPayload(command: string): string {
	return command.match(SHELL_WRAPPER)?.[2] ?? command;
}

/** Split a payload into simple commands, keeping the operator between them. */
export function shellSegments(command: string): ShellSegment[] {
	const parts = shellPayload(command).replace(HEREDOC, "$<rest>").split(SEGMENT_SEPARATOR);
	const segments: ShellSegment[] = [];
	for (let index = 0; index < parts.length; index += 2) {
		const tokens = shellTokens(parts[index] ?? "");
		// A newline ends a command the way `;` does.
		const operator = parts[index + 1] === "\n" ? ";" : parts[index + 1];
		const next = operator as ShellSegment["next"];
		if (tokens.length) segments.push({ tokens, next });
	}
	return segments;
}

/** Whitespace/quote tokens with redirection prefixes and `--opt=` prefixes removed. */
export function shellTokens(segment: string): string[] {
	return segment
		.trim()
		.split(TOKEN_SEPARATORS)
		.map((token) => token.replace(REDIRECTION_PREFIX, "").replace(ESCAPE_TAIL, ""))
		.map((token) => token.match(OPTION_VALUE)?.[1] ?? token)
		.filter(Boolean);
}
