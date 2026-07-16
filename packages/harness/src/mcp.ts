import { isAbsolute, join } from "node:path";

/** Cursor SDK MCP server config (stdio or HTTP/SSE). */
export type McpServerConfig =
	| {
			type?: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
			/** Local only — resolved relative to the agent cwd when relative. */
			cwd?: string;
	  }
	| {
			type?: "http" | "sse";
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

/** Resolve cwd-relative stdio paths and expand env placeholders for Agent.create. */
export function resolveMcpServers(
	servers: Record<string, McpServerConfig> | undefined,
	options: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Record<string, McpServerConfig> | undefined {
	if (!servers || Object.keys(servers).length === 0) {
		return undefined;
	}

	const env = options.env ?? process.env;
	const resolved: Record<string, McpServerConfig> = {};

	for (const [name, config] of Object.entries(servers)) {
		if ("command" in config && config.command) {
			const serverCwd =
				config.cwd === undefined
					? options.cwd
					: isAbsolute(config.cwd)
						? config.cwd
						: join(options.cwd, config.cwd);
			resolved[name] = {
				type: config.type ?? "stdio",
				command: expandEnvPlaceholders(config.command, env),
				args: config.args?.map((arg) => expandEnvPlaceholders(arg, env)),
				env: expandRecord(config.env, env),
				cwd: serverCwd,
			};
			continue;
		}

		if ("url" in config && config.url) {
			resolved[name] = {
				type: config.type ?? "http",
				url: expandEnvPlaceholders(config.url, env),
				headers: expandRecord(config.headers, env),
				auth: config.auth
					? {
							CLIENT_ID: expandEnvPlaceholders(config.auth.CLIENT_ID, env),
							CLIENT_SECRET:
								config.auth.CLIENT_SECRET === undefined
									? undefined
									: expandEnvPlaceholders(config.auth.CLIENT_SECRET, env),
							scopes: config.auth.scopes,
						}
					: undefined,
			};
			continue;
		}

		throw new Error(`Invalid MCP server "${name}": expected stdio command or http/sse url`);
	}

	return resolved;
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
