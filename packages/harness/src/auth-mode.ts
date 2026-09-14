/** How a host bills a run. The two modes charge different accounts. */
export type HostAuthMode = "api-key" | "subscription";

export const HOST_AUTH_MODES: HostAuthMode[] = ["api-key", "subscription"];

/** CLI and library default when no flag, option, or env value is set. */
export const DEFAULT_HOST_AUTH_MODE: HostAuthMode = "subscription";

let processAuthMode: HostAuthMode | undefined;

/** Process-wide auth mode from `--auth-mode`. Wins over per-host env vars. */
export function setProcessAuthMode(mode: HostAuthMode | undefined): void {
	processAuthMode = mode;
}

export function getProcessAuthMode(): HostAuthMode | undefined {
	return processAuthMode;
}

/**
 * Parse an explicit auth-mode value. Throws on a misspelled value.
 * Returns undefined when the variable is unset.
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

/** Parse `--auth-mode` / `--auth-method`. Throws on a misspelled value. */
export function parseHostAuthModeFlag(raw: string, flagName = "--auth-mode"): HostAuthMode {
	const value = raw.trim();
	if (!(HOST_AUTH_MODES as string[]).includes(value)) {
		throw new Error(`${flagName} must be ${HOST_AUTH_MODES.join(" or ")}`);
	}
	return value as HostAuthMode;
}

/**
 * Resolve auth mode.
 *
 * Order: explicit option, process `--auth-mode`, per-host env, subscription.
 * A leftover API key does not select api-key.
 */
export function resolveHostAuthMode(options: {
	envName: string;
	raw: string | undefined;
	explicit?: HostAuthMode;
}): HostAuthMode {
	if (options.explicit) {
		return options.explicit;
	}
	if (processAuthMode) {
		return processAuthMode;
	}
	return parseOptionalAuthMode(options.envName, options.raw) ?? DEFAULT_HOST_AUTH_MODE;
}

/**
 * Cursor and OpenAI auth.
 *
 * Same resolution as `resolveHostAuthMode`. Throws when the resolved mode is
 * api-key and no key is present.
 */
export function resolveKeyOrLoginAuthMode(options: {
	envName: string;
	raw: string | undefined;
	hasApiKey: boolean;
	missingKeyMessage: string;
	explicit?: HostAuthMode;
}): HostAuthMode {
	const mode = resolveHostAuthMode(options);
	if (mode === "api-key" && !options.hasApiKey) {
		throw new Error(options.missingKeyMessage);
	}
	return mode;
}
