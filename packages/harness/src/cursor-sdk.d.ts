declare module "@cursor/sdk" {
	export type AgentModeOption = "agent" | "plan";

	export interface ModelParameterValue {
		id: string;
		value: string;
	}

	export interface ModelSelection {
		id: string;
		params?: ModelParameterValue[];
	}

	export type McpServerConfig =
		| {
				type?: "stdio";
				command: string;
				args?: string[];
				env?: Record<string, string>;
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

	export interface CursorAgentOptions {
		apiKey: string;
		name?: string;
		local?: { cwd: string };
		model?: ModelSelection;
		/** Inline MCP servers — fully replace creation-time servers when set on send. */
		mcpServers?: Record<string, McpServerConfig>;
	}

	export interface SendOptions {
		model?: ModelSelection;
		mode?: AgentModeOption;
		mcpServers?: Record<string, McpServerConfig>;
	}

	export interface SdkTextBlock {
		type: string;
		text?: string;
	}

	export interface SdkToolPayload {
		name?: string;
		input?: unknown;
		output?: string;
	}

	export interface SdkMessage {
		type: string;
		name?: string;
		args?: Record<string, unknown>;
		call_id?: string;
		/** Present on tool_call completed/error events (SDKToolUseMessage.result). */
		result?: unknown;
		message?: {
			role?: string;
			content?: SdkTextBlock[];
		};
		tool?: SdkToolPayload;
	}

	export interface RunResult {
		id: string;
		status: string;
		error?: { message?: string; code?: string };
	}

	export interface AgentRun {
		stream(): AsyncIterable<SdkMessage>;
		messages(): AsyncIterable<SdkMessage>;
		wait(): Promise<RunResult>;
	}

	export interface DisposableAgent {
		send(prompt: string, options?: SendOptions): Promise<AgentRun>;
		[Symbol.asyncDispose](): Promise<void>;
	}

	export const Agent: {
		prompt: (
			prompt: string,
			options: CursorAgentOptions,
		) => Promise<{
			status: string;
			result?: string;
			error?: { message?: string; code?: string };
		}>;
		create: (options: CursorAgentOptions) => Promise<DisposableAgent>;
	};
}
