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

	export interface CursorAgentOptions {
		apiKey: string;
		name?: string;
		local?: { cwd: string };
		model?: ModelSelection;
	}

	export interface SendOptions {
		model?: ModelSelection;
		mode?: AgentModeOption;
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
		message?: {
			role?: string;
			content?: SdkTextBlock[];
		};
		tool?: SdkToolPayload;
	}

	export interface RunResult {
		id: string;
		status: string;
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
		) => Promise<{ status: string; result?: string; error?: { message: string } }>;
		create: (options: CursorAgentOptions) => Promise<DisposableAgent>;
	};
}
