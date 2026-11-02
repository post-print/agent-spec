import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentDefinition } from "./agent-definition.js";
import { resolveClaudeBin } from "./claude-run.js";
import { resolveOpenaiBin } from "./openai-run.js";

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
/** What a session was launched under, as far as the harness can state it. */
export interface HostConditions {
	host: string;
	binary?: string;
	binaryVersion?: string;
	authMode?: string;
	confinement: Confinement;
	network: NetworkState;
	settingSources?: string[];
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
	if (agent.host === "openai" || agent.host === "claude")
		return !readOnly && agent.options.networkAccess === true ? "enabled" : "disabled";
	return "unknown";
}
function settingSources(agent: AgentDefinition): string[] | undefined {
	const includeGlobal = agent.options.includeGlobalSkills === true;
	if (agent.host === "claude") {
		if (includeGlobal) return ["user", "project"];
		// See claudeSessionFlags: API-key auth with no project context runs `--bare`.
		const bare =
			agent.options.auth?.type === "api-key" && agent.options.loadProjectContext === false;
		return bare ? [] : ["project"];
	}
	if (agent.host === "openai") return includeGlobal ? ["user"] : [];
	return undefined;
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
		confinement:
			agent.host === "claude" || agent.host === "openai" ? "host-enforced" : "detect-only",
		network: networkState(agent, readOnly),
		settingSources: settingSources(agent),
		overridingEnv: OVERRIDING_ENV.filter((name) => process.env[name] !== undefined),
	};
}
