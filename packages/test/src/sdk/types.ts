import type { AgentCapabilities, AgentDefinition, AgentTrace } from "@post-print/agent-harness";
import type { StartingContext, WorkspaceSnapshot } from "./workspace.js";

export interface Criterion {
	description: string;
	scores: Record<number, string>;
}
export type Criteria = Record<string, Criterion>;
export interface JudgeDefinition<C extends Criteria = Criteria> {
	agent: AgentDefinition;
	criteria: C;
	context?: { reference?: { text?: string; files?: readonly string[] }; includeMetrics?: boolean };
}
export interface EvidenceReference {
	source: "transcript" | "workspace" | "reference";
	path?: string;
	snapshot?: "initial" | "final";
	line?: number;
	event?: number;
}
export interface Grade<C extends Criteria = Criteria> {
	scores: { [K in keyof C]: number };
	reasons: { [K in keyof C]: string };
	evidence: { [K in keyof C]: EvidenceReference[] };
	usage: RunUsage;
	artifact: string;
}
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
	prompt: string;
	output: string;
	trace: AgentTrace;
	conversation: AgentTrace;
	toolCalls: AgentTrace["toolCalls"];
	durationMs: number;
	usage: RunUsage;
	capabilities: AgentCapabilities;
	startingContext: StartingContext;
	workspace: {
		root: string;
		initial: WorkspaceSnapshot;
		final: WorkspaceSnapshot;
		changedPaths: string[];
	};
	judge<C extends Criteria>(definition: JudgeDefinition<C>): Promise<Grade<C>>;
}
export interface Statistics {
	available: boolean;
	count: number;
	mean: number;
	min: number;
	max: number;
}
export interface VariantResult {
	runs: Run[];
	metrics: {
		tokens: { input: Statistics; output: Statistics; total: Statistics };
		durationMs: Statistics;
		toolCalls: Statistics;
	};
}
export interface ComparisonGrade<C extends Criteria, V extends string> {
	variants: Record<V, { runs: Grade<C>[]; scores: { [K in keyof C]: number } }>;
	winner: V | null;
}
export interface Comparison<V extends string = string> {
	runs: Run[];
	variants: Record<V, VariantResult>;
	judge<C extends Criteria>(definition: JudgeDefinition<C>): Promise<ComparisonGrade<C, V>>;
}
export interface Variant {
	agent?: AgentDefinition;
	prompt?: string;
	workspace?: string;
	repeat?: number;
	expectedFailures?: readonly string[];
}
export type Check = (name: string, assertion: () => unknown | Promise<unknown>) => Promise<void>;
export interface CompareOptions<V extends string> {
	prompt: string;
	variants: Record<V, Variant>;
	checks?: (run: Run, check: Check) => Promise<void>;
}
