import type { HostAdapter } from "./types.js";
import { AGENT_HOSTS, type AgentHost, isBuiltinAgentHost, isHostSlug } from "./types.js";

const RESERVED_HOST_IDS = new Set<string>([...AGENT_HOSTS, "replay", "all"]);

const adapters = new Map<string, HostAdapter>();

export function reservedHostIds(): readonly string[] {
	return [...RESERVED_HOST_IDS];
}

export function listRegisteredHosts(): AgentHost[] {
	return [...adapters.keys()];
}

export function getRegisteredAdapter(host: string): HostAdapter | undefined {
	return adapters.get(host);
}

export function knownAgentHosts(): AgentHost[] {
	return [...AGENT_HOSTS, ...listRegisteredHosts()];
}

export function isKnownAgentHost(value: string): value is AgentHost {
	return isBuiltinAgentHost(value) || adapters.has(value);
}

export function clearRegisteredHostAdapters(): void {
	adapters.clear();
}

export function unregisterHostAdapter(host: string): boolean {
	return adapters.delete(host);
}

/** Register a consumer host adapter. Builtin ids stay reserved. */
export function registerHostAdapter(adapter: HostAdapter): void {
	const host = adapter.host?.trim() ?? "";
	if (!isHostSlug(host)) {
		throw new Error(
			`Host id must be a lowercase slug (a-z, digits, hyphen), got ${JSON.stringify(adapter.host)}`,
		);
	}
	if (RESERVED_HOST_IDS.has(host)) {
		throw new Error(`Host id "${host}" is reserved. Pick a different slug.`);
	}
	if (adapters.has(host)) {
		throw new Error(`Host "${host}" is already registered.`);
	}
	adapters.set(host, adapter);
}
