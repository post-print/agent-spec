import { basename, resolve } from "node:path";
import type { AgentDefinition, AgentOptions } from "@post-print/agent-harness";
import type { z } from "zod/v4";
import type { AgentSettings, JudgeSettings, WorkspaceSetup } from "./types.js";
export interface AgentResource {
	readonly kind: "agent";
	readonly settings: AgentSettings;
	readonly preparation: readonly WorkspaceSetup[];
	setup(prepare: WorkspaceSetup): AgentResource;
}
export interface JudgeResource<S extends z.ZodType = z.ZodType> {
	readonly kind: "judge";
	readonly settings: JudgeSettings<S>;
}
export type Resource = AgentResource | JudgeResource;
export const factories = {
	agent: (settings: AgentSettings = {}): AgentResource => agentResource(cloneSettings(settings)),
	judge: <S extends z.ZodType>(settings: JudgeSettings<S>): JudgeResource<S> => {
		if (!settings.prompt.trim()) throw new Error("Judge prompt is required");
		return {
			kind: "judge",
			settings: { ...cloneSettings(settings), prompt: settings.prompt, schema: settings.schema },
		};
	},
};
function agentResource(
	settings: AgentSettings,
	preparation: readonly WorkspaceSetup[] = [],
): AgentResource {
	return {
		kind: "agent",
		settings,
		preparation,
		setup: (prepare) => agentResource(settings, [...preparation, prepare]),
	};
}
function cloneSettings<T extends AgentSettings>(settings: T): T {
	const { agent, ...options } = settings;
	// Schemas and setup functions stay in the test process; host options are copied separately.
	const { schema: _schema, ...plain } = options as typeof options & { schema?: unknown };
	return { ...structuredClone(plain), agent } as T;
}
export function mergeSettings(base: AgentSettings, extra: AgentSettings): AgentSettings {
	return {
		...base,
		...extra,
		skills: [...new Set([...(base.skills ?? []), ...(extra.skills ?? [])])],
		context: {
			instructions: [...(base.context?.instructions ?? []), ...(extra.context?.instructions ?? [])],
			files: [...new Set([...(base.context?.files ?? []), ...(extra.context?.files ?? [])])],
		},
		mcpServers: { ...base.mcpServers, ...extra.mcpServers },
	};
}
export function configuredAgent(
	defaultAgent: AgentDefinition | undefined,
	settings: AgentSettings,
): AgentDefinition {
	const selected = settings.agent ?? defaultAgent;
	if (!selected) throw new Error("Configure an agent definition for this resource");
	const { agent: _agent, workspace: _workspace, ...options } = settings;
	return {
		...selected,
		options: mergeSettings(selected.options, options) as AgentOptions & Record<string, unknown>,
	};
}
export function validateSkills(skills: readonly string[], baseDir: string) {
	const names = new Map<string, string>();
	for (const skill of skills) {
		const source = resolve(baseDir, skill),
			name = basename(source);
		if (names.has(name) && names.get(name) !== source)
			throw new Error(`Conflicting skill destination: ${name}`);
		names.set(name, source);
	}
}
