/** How a host bills a run. The two modes charge different accounts. */
export type HostAuthMode = "api-key" | "subscription";

export const HOST_AUTH_MODES: HostAuthMode[] = ["api-key", "subscription"];

/**
 * Parse an explicit auth-mode value. Throws on a misspelled value.
 * Returns undefined when the variable is unset so a host can keep a key-only default.
 */
export function parseOptionalAuthMode(
	envName: string,
	raw: string | undefined,
): HostAuthMode | undefined {
	const value = raw?.trim();
	if (!value) {
		return undefined;
	}
	if (!(HOST_AUTH_MODES as string[]).includes(value)) {
		throw new Error(`${envName}="${value}" is invalid — choose ${HOST_AUTH_MODES.join(" or ")}`);
	}
	return value as HostAuthMode;
}

/**
 * Cursor and OpenAI auth.
 *
 * An explicit mode always wins. When the mode is unset, a present API key
 * keeps the current api-key default. When both are unset, the error names
 * the key and the login mode. Subscription mode ignores a stale key.
 */
export function resolveKeyOrLoginAuthMode(options: {
	envName: string;
	raw: string | undefined;
	hasApiKey: boolean;
	missingKeyMessage: string;
}): HostAuthMode {
	const mode = parseOptionalAuthMode(options.envName, options.raw);
	if (mode === "subscription") {
		return "subscription";
	}
	if (mode === "api-key" || options.hasApiKey) {
		if (!options.hasApiKey) {
			throw new Error(options.missingKeyMessage);
		}
		return "api-key";
	}
	throw new Error(options.missingKeyMessage);
}
