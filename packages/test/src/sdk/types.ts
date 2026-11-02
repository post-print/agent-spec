import type {
	AgentCapabilities,
	AgentDefinition,
	AgentOptions,
	AgentTrace,
	WorktreeSource,
} from "@post-print/agent-harness";
import type { z } from "zod";
import type { EnvironmentObservation, ObserveEnvironment } from "./environment-observation.js";
import type { RunExposure, RunRecord } from "./run-record.js";
import type { StartingContext, Workspace, WorkspaceSnapshot } from "./workspace.js";
/**
 * Where a run's workspace comes from: a folder of the caller checkout, sealed into a copy, or
 * `{ worktree }`, a real git worktree of a repository, for a suite that accepts `confinement`.
 */
export type WorkspaceSource = string | WorktreeSource;
export interface AgentSettings extends AgentOptions {
	agent?: AgentDefinition;
	description?: string;
	workspace?: WorkspaceSource;
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
	/** Which model judged, because a verdict is only as stable as its model. */
	model: { requested?: string; observed?: string };
	/**
	 * Which judge this was, by its prompt, schema, host and model, and whether labelled fixtures
	 * agreed with it in the last week. A pass resting on an uncalibrated judge is only indicative.
	 */
	judge: { key: string; calibrated: boolean };
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
