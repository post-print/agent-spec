import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentDefinition } from "./agent-definition.js";
import { resolveClaudeBin } from "./claude-run.js";
import { resolveOpenaiBin } from "./openai-run.js";
import { claudeSessionFlags } from "./user-skills.js";

const run = promisify(execFile);
const VERSION_TIMEOUT_MS = 2_000;
const OVERRIDING_ENV = [
	"CLAUDE_AGENT_MODEL",
	"CLAUDE_CODE_ALLOWED_TOOLS",
	"CLAUDE_CODE_BIN",
	"CODEX_AGENT_MODEL",
	"CODEX_BIN",
	"CURSOR_AGENT_MODEL",
	"OPENAI_AGENT_MODEL",
];

export type Confinement = "host-enforced" | "detect-only";
export type NetworkState = "enabled" | "disabled" | "unknown";
/**
 * Whether the host's own user configuration can reach the run: instructions such as a user
 * CLAUDE.md, hooks, plugins, or global skills. "may-load" means nothing shuts it out.
 */
export type UserConfig = "excluded" | "may-load" | "unknown";
/** Whether the agent can read the real home: "sealed" only when the host denies it. */
export type HomeAccess = "sealed" | "readable" | "unknown";
/** What a session was launched under, as far as the harness can state it. */
export interface HostConditions {
	host: string;
	binary?: string;
	binaryVersion?: string;
	authMode?: string;
	confinement: Confinement;
	network: NetworkState;
	settingSources?: string[];
	userConfig: UserConfig;
	home: HomeAccess;
	/** Folders outside the workspace the test let its agent read. */
	allowedRoots: string[];
	/** The permission rules an unconfined Claude may use without asking. */
	allowedTools: string[];
	/** Names only: values can hold secrets or local paths. */
	overridingEnv: string[];
}

async function binaryVersion(binary: string | undefined): Promise<string | undefined> {
	if (!binary) return undefined;
	try {
		const { stdout } = await run(binary, ["--version"], { timeout: VERSION_TIMEOUT_MS });
		return stdout.trim().split("\n")[0];
	} catch {
		return undefined;
	}
}
async function resolvedBinary(agent: AgentDefinition): Promise<string | undefined> {
	try {
		if (agent.host === "claude") return await resolveClaudeBin();
		if (agent.host === "openai") return await resolveOpenaiBin();
	} catch {
		// The run itself reports a missing binary as a typed failure.
	}
	return undefined;
}
function networkState(agent: AgentDefinition, readOnly: boolean): NetworkState {
	// Only Claude's sandbox limits the network, so an unconfined agent reaches every host.
	if (confinement(agent, readOnly) === "detect-only" && agent.host === "claude") return "enabled";
	if (agent.host === "openai" || agent.host === "claude")
		return !readOnly && agent.options.networkAccess === true ? "enabled" : "disabled";
	return "unknown";
}
/** The session flags the Claude host passes, as `claudeSessionFlags` builds them for the worker. */
function claudeFlags(agent: AgentDefinition): string[] {
	return claudeSessionFlags(
		agent.options.auth?.type ?? "subscription",
		agent.options.includeGlobalSkills === true,
		agent.options.loadProjectContext !== false,
	);
}
function settingSources(agent: AgentDefinition): string[] | undefined {
	const includeGlobal = agent.options.includeGlobalSkills === true;
	if (agent.host === "claude") {
		const flags = claudeFlags(agent);
		const sources = flags[flags.indexOf("--setting-sources") + 1];
		// `--bare` loads no setting source at all.
		return flags.includes("--bare") ? [] : (sources?.split(",") ?? []);
	}
	if (agent.host === "openai") return includeGlobal ? ["user"] : [];
	return undefined;
}
/**
 * Claude keeps the user's own configuration (user CLAUDE.md, settings, hooks, plugins, skills)
 * out under `--bare`, or when it loads no "user" setting source and only the suite's MCP servers
 * (`--strict-mcp-config`). Codex runs with `--ignore-user-config` and a temporary home unless
 * global skills are asked for. Nothing has shown what Cursor or a custom adapter loads.
 */
function userConfig(agent: AgentDefinition): UserConfig {
	if (agent.host === "claude") {
		const flags = claudeFlags(agent);
		const userSettingsOut =
			flags.includes("--strict-mcp-config") && !settingSources(agent)?.includes("user");
		return flags.includes("--bare") || userSettingsOut ? "excluded" : "may-load";
	}
	if (agent.host === "openai")
		return agent.options.includeGlobalSkills === true ? "may-load" : "excluded";
	return "unknown";
}
/** An unconfined Claude agent runs unsandboxed; a read-only reviewer stays sandboxed. */
function confinement(agent: AgentDefinition, readOnly: boolean): Confinement {
	if (agent.host === "claude")
		return agent.options.confinement === "none" && !readOnly ? "detect-only" : "host-enforced";
	return agent.host === "openai" ? "host-enforced" : "detect-only";
}
function homeAccess(agent: AgentDefinition): HomeAccess {
	if (agent.host !== "claude" && agent.host !== "openai") return "unknown";
	return agent.options.sealHome === true ? "sealed" : "readable";
}
export async function hostConditions(
	agent: AgentDefinition,
	readOnly: boolean,
): Promise<HostConditions> {
	const binary = await resolvedBinary(agent);
	return {
		host: agent.host ?? "custom",
		binary,
		binaryVersion: await binaryVersion(binary),
		authMode: agent.host ? (agent.options.auth?.type ?? "subscription") : undefined,
		confinement: confinement(agent, readOnly),
		network: networkState(agent, readOnly),
		settingSources: settingSources(agent),
		userConfig: userConfig(agent),
		home: homeAccess(agent),
		allowedRoots: [...(agent.options.allowedRoots ?? [])],
		allowedTools: [...(agent.options.allowedTools ?? [])],
		overridingEnv: OVERRIDING_ENV.filter((name) => process.env[name] !== undefined),
	};
}
