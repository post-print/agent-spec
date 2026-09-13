import {
	type AgentHost,
	isBuiltinAgentHost,
	isHostSlug,
	knownAgentHosts,
} from "@post-print/agent-harness";

const HOST_FLAG_HELP = "cursor|claude|openai|all|<slug>";

/** Deduplicate hosts and keep first-seen order. */
export function uniqueHosts(hosts: readonly AgentHost[] | undefined): AgentHost[] | undefined {
	if (!hosts || hosts.length === 0) {
		return undefined;
	}
	const seen = new Set<AgentHost>();
	const unique: AgentHost[] = [];
	for (const host of hosts) {
		if (seen.has(host)) {
			continue;
		}
		seen.add(host);
		unique.push(host);
	}
	return unique;
}

/**
 * Parse `--host` values.
 * Accepts `all`, comma-separated names, and repeatable flags (caller concatenates).
 */
export function parseHostList(raw: string): AgentHost[] {
	const tokens = raw
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0);
	if (tokens.length === 0) {
		throw new Error(`--host must be ${HOST_FLAG_HELP}`);
	}
	const hosts: AgentHost[] = [];
	for (const token of tokens) {
		if (token === "replay") {
			throw new Error(
				"Replay-based testing is deprecated and no longer supported; use --host cursor, --host claude, or --host openai.",
			);
		}
		if (token === "all") {
			for (const host of knownAgentHosts()) {
				if (!hosts.includes(host)) {
					hosts.push(host);
				}
			}
			continue;
		}
		if (!isBuiltinAgentHost(token) && !isHostSlug(token)) {
			throw new Error(`--host must be ${HOST_FLAG_HELP}`);
		}
		if (!hosts.includes(token)) {
			hosts.push(token);
		}
	}
	return hosts;
}

/** Hosts one suite run will launch after CLI, suite `hosts`, and `defaults.host`. */
export function resolveSuiteHosts(options: {
	cliHosts?: readonly AgentHost[];
	suiteHosts?: readonly AgentHost[];
	defaultHost?: AgentHost;
}): AgentHost[] {
	const fallback = options.defaultHost ?? "cursor";
	const cli = uniqueHosts(options.cliHosts);
	const suite = uniqueHosts(options.suiteHosts);
	if (cli && suite) {
		const allowed = new Set(suite);
		const filtered = cli.filter((host) => allowed.has(host));
		if (filtered.length === 0) {
			throw new Error(`--host ${cli.join(",")} does not match suite hosts ${suite.join(",")}`);
		}
		return filtered;
	}
	if (cli) {
		return cli;
	}
	if (suite) {
		return suite;
	}
	return [fallback];
}

/**
 * When a matrix locks the host, skip scenarios pinned to a different host.
 * A single-host run still lets `scenario.host` override the default.
 */
export function scenarioRunsOnHost(
	scenario: { host?: AgentHost },
	host: AgentHost,
	hostLocked: boolean,
): boolean {
	if (!hostLocked || scenario.host === undefined) {
		return true;
	}
	return scenario.host === host;
}
