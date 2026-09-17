import type { AgentTrace, AgentUsage, BuiltinAgentHost, McpServerConfig } from "./types.js";

export type AgentAuth = { type: "subscription" } | { type: "api-key"; env: string };
export interface AgentContext {
	instructions?: readonly string[];
	files?: readonly string[];
}
export interface AgentOptions {
	model?: string;
	auth?: AgentAuth;
	skills?: readonly string[];
	context?: AgentContext;
	/** Include host-global skills only when explicitly enabled. Defaults to false. */
	includeGlobalSkills?: boolean;
	mcpServers?: Record<string, McpServerConfig>;
	networkAccess?: boolean;
}
export interface AgentDefinition {
	readonly host?: BuiltinAgentHost;
	readonly adapter?: string;
	readonly options: Readonly<AgentOptions & Record<string, unknown>>;
}
export interface AgentCapabilities {
	conversation: "native" | "reconstructed";
	toolCalls?: boolean;
	commandExitCodes?: boolean;
	fileReads?: boolean;
	tokenUsage?: boolean;
	readOnly?: boolean;
}
export type AgentEvent =
	| { type: "text"; text: string }
	| {
			type: "tool";
			name: string;
			args?: Record<string, unknown>;
			result?: string;
			exitCode?: number;
			succeeded?: boolean;
	  }
	| { type: "usage"; usage: AgentUsage }
	| { type: "trace"; trace: AgentTrace };
export interface AdapterSession {
	run(prompt: string): AsyncIterable<AgentEvent>;
	close(): Promise<void>;
}
export interface AgentAdapter<T = Record<string, unknown>> {
	name: string;
	capabilities: AgentCapabilities;
	createSession(input: {
		options: T;
		workspace: { path: string };
		signal: AbortSignal;
		readOnly: boolean;
	}): Promise<AdapterSession>;
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function definition(value: AgentDefinition): AgentDefinition {
	if (Object.hasOwn(value.options, "allowUserSkills"))
		throw new Error("allowUserSkills was renamed to includeGlobalSkills");
	const copy = JSON.parse(
		JSON.stringify(
			{
				...value,
				options: {
					...value.options,
					includeGlobalSkills: value.options.includeGlobalSkills ?? false,
				},
			},
			(_key, item) => {
				if (typeof item === "function" || typeof item === "symbol" || typeof item === "bigint")
					throw new Error("Agent definitions must contain serializable configuration only");
				return item;
			},
		),
	) as AgentDefinition;
	if (value.options.auth?.type === "api-key" && !value.options.auth.env.trim()) {
		throw new Error("API-key authentication requires an environment variable name");
	}
	return freeze(copy);
}
function builtin(host: BuiltinAgentHost, options: AgentOptions = {}): AgentDefinition {
	if (options.networkAccess && host !== "openai")
		throw new Error(`networkAccess is not supported by ${host}`);
	return definition({
		host,
		options: { auth: { type: "subscription" }, ...options },
	});
}
/** Run the OpenAI Codex coding agent. Does not start a session. */
export const openai = (options?: AgentOptions): AgentDefinition => builtin("openai", options);
export const claude = (options?: AgentOptions): AgentDefinition => builtin("claude", options);
export const cursor = (options?: AgentOptions): AgentDefinition => builtin("cursor", options);
export function customAgent<T extends Record<string, unknown>>(input: {
	adapter: string;
	options: T & AgentOptions;
}): AgentDefinition {
	return definition(input);
}
export function defineAgent<T>(adapter: AgentAdapter<T>): AgentAdapter<T> {
	return adapter;
}
