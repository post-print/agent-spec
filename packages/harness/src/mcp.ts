import { isAbsolute, join } from "node:path";

/** Cursor SDK MCP server config (stdio or HTTP/SSE). */
export type McpServerConfig =
	| {
			type?: "stdio";
			/** Display-only tool inventory for catalogs and reports. Never sent to the host. */
			tools?: string[];
			command: string;
			args?: string[];
			env?: Record<string, string>;
			/** Local only — resolved relative to the agent cwd when relative. */
			cwd?: string;
	  }
	| {
			type?: "http" | "sse";
			/** Display-only tool inventory for catalogs and reports. Never sent to the host. */
			tools?: string[];
			url: string;
			headers?: Record<string, string>;
			auth?: {
				CLIENT_ID: string;
				CLIENT_SECRET?: string;
				scopes?: string[];
			};
	  };

const ENV_INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Expand `${VAR}` placeholders; throw if a referenced env var is missing. */
export function expandEnvPlaceholders(value: string, env: NodeJS.ProcessEnv = process.env): string {
	return value.replace(ENV_INTERPOLATION, (_match, name: string) => {
		const resolved = env[name];
		if (resolved === undefined) {
			throw new Error(`MCP config references unset environment variable: ${name}`);
		}
		return resolved;
	});
}

function expandRecord(
	record: Record<string, string> | undefined,
	env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
	if (!record) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		out[key] = expandEnvPlaceholders(value, env);
	}
	return out;
}

type HttpMcp = Extract<McpServerConfig, { url: string }>;
type StdioMcp = Extract<McpServerConfig, { command: string }>;
function expandAuth(auth: HttpMcp["auth"], env: NodeJS.ProcessEnv): HttpMcp["auth"] {
	if (!auth) return undefined;
	return {
		CLIENT_ID: expandEnvPlaceholders(auth.CLIENT_ID, env),
		CLIENT_SECRET:
			auth.CLIENT_SECRET === undefined ? undefined : expandEnvPlaceholders(auth.CLIENT_SECRET, env),
		scopes: auth.scopes,
	};
}
function resolveStdio(config: StdioMcp, cwd: string, env: NodeJS.ProcessEnv): McpServerConfig {
	const serverCwd =
		config.cwd === undefined ? cwd : isAbsolute(config.cwd) ? config.cwd : join(cwd, config.cwd);
	return {
		type: config.type ?? "stdio",
		command: expandEnvPlaceholders(config.command, env),
		args: config.args?.map((arg) => expandEnvPlaceholders(arg, env)),
		env: expandRecord(config.env, env),
		cwd: serverCwd,
	};
}
function resolveServer(
	config: McpServerConfig,
	options: { name: string; cwd: string; env: NodeJS.ProcessEnv },
): McpServerConfig {
	const { name, cwd, env } = options;
	if ("command" in config && config.command) return resolveStdio(config, cwd, env);
	if ("url" in config && config.url)
		return {
			type: config.type ?? "http",
			url: expandEnvPlaceholders(config.url, env),
			headers: expandRecord(config.headers, env),
			auth: expandAuth(config.auth, env),
		};
	throw new Error(`Invalid MCP server "${name}": expected stdio command or http/sse url`);
}
/** Resolve cwd-relative stdio paths and expand env placeholders for Agent.create. */
export function resolveMcpServers(
	servers: Record<string, McpServerConfig> | undefined,
	options: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Record<string, McpServerConfig> | undefined {
	if (!servers || Object.keys(servers).length === 0) return undefined;
	const env = options.env ?? process.env;
	return Object.fromEntries(
		Object.entries(servers).map(([name, config]) => [
			name,
			resolveServer(config, { name, cwd: options.cwd, env }),
		]),
	);
}

/** Shallow-merge suite defaults with scenario overrides (scenario wins per server name). */
export function mergeMcpServers(
	defaults?: Record<string, McpServerConfig>,
	overrides?: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> | undefined {
	if (!defaults && !overrides) {
		return undefined;
	}
	const merged = { ...defaults, ...overrides };
	return Object.keys(merged).length > 0 ? merged : undefined;
}
