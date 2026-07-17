import type { McpServerConfig } from "@post-print/agent-harness";

/** Validate a suite/scenario mcpServers map (shape only; env expansion happens at run time). */
export function isMcpServersMap(value: unknown): value is Record<string, McpServerConfig> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	for (const [name, config] of Object.entries(value)) {
		if (typeof name !== "string" || name.length === 0) {
			return false;
		}
		if (!isMcpServerConfig(config)) {
			return false;
		}
	}
	return true;
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const config = value as Record<string, unknown>;
	if (typeof config.command === "string" && config.command.length > 0) {
		if (config.type !== undefined && config.type !== "stdio") {
			return false;
		}
		if (config.args !== undefined && !isStringArray(config.args)) {
			return false;
		}
		if (config.env !== undefined && !isStringRecord(config.env)) {
			return false;
		}
		if (config.cwd !== undefined && typeof config.cwd !== "string") {
			return false;
		}
		return true;
	}
	if (typeof config.url === "string" && config.url.length > 0) {
		if (config.type !== undefined && config.type !== "http" && config.type !== "sse") {
			return false;
		}
		if (config.headers !== undefined && !isStringRecord(config.headers)) {
			return false;
		}
		if (config.auth !== undefined && !isMcpAuth(config.auth)) {
			return false;
		}
		return true;
	}
	return false;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every((item) => typeof item === "string");
}

function isMcpAuth(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const auth = value as Record<string, unknown>;
	if (typeof auth.CLIENT_ID !== "string") {
		return false;
	}
	if (auth.CLIENT_SECRET !== undefined && typeof auth.CLIENT_SECRET !== "string") {
		return false;
	}
	if (auth.scopes !== undefined && !isStringArray(auth.scopes)) {
		return false;
	}
	return true;
}
