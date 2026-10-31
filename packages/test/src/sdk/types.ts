import type {
	AgentCapabilities,
	AgentDefinition,
	AgentOptions,
	AgentTrace,
} from "@post-print/agent-harness";
import type { z } from "zod";
import type { EnvironmentObservation, ObserveEnvironment } from "./environment-observation.js";
import type { RunExposure, RunRecord } from "./run-record.js";
import type { StartingContext, Workspace, WorkspaceSnapshot } from "./workspace.js";
export interface AgentSettings extends AgentOptions {
	agent?: AgentDefinition;
	description?: string;
	workspace?: string;
	/** Record processes, listening ports, and named paths left behind after each run. */
	observeEnvironment?: ObserveEnvironment;
}
export interface RunOptions extends Omit<AgentSettings, "agent" | "description"> {
	prompt: string;
}
export interface JudgeSettings<S extends z.ZodType = z.ZodType>
	extends Omit<AgentSettings, "workspace"> {
	prompt: string;
	schema: S;
}
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };
export interface RunUsage {
	tokens: {
		input?: number;
		output?: number;
		total?: number;
		cacheRead?: number;
		cacheWrite?: number;
		reasoning?: number;
	};
}
export interface Run {
	id: string;
	name: string;
	prompt: string;
	output: string;
	trace: AgentTrace;
	conversation: AgentTrace;
	toolCalls: AgentTrace["toolCalls"];
	durationMs: number;
	usage: RunUsage;
	capabilities: AgentCapabilities;
	startingContext: StartingContext;
	/** The conditions this run happened under. */
	record: RunRecord;
	/** What the agent could see it was offered. */
	exposure: RunExposure;
	environment?: EnvironmentObservation;
	artifact: string;
	workspace: {
		root: string;
		initial: WorkspaceSnapshot;
		final: WorkspaceSnapshot;
		changedPaths: string[];
	};
	continue(options: { prompt: string }): Promise<Run>;
}
export interface Evaluation<T = unknown> {
	id: string;
	name: string;
	output: T;
	usage: RunUsage;
	artifact: string;
}
export type WorkspaceSetup = (workspace: Workspace) => void | Promise<void>;
export interface AgentFixture {
	setup(prepare: WorkspaceSetup): AgentFixture;
	run(options: RunOptions): Promise<Run>;
}
export interface JudgeFixture<T> {
	run(options: { input: JsonValue }): Promise<Evaluation<T>>;
}
export interface Statistics {
	available: boolean;
	count: number;
	mean: number;
	min: number;
	max: number;
}
