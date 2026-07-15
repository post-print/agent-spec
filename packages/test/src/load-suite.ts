import { readFile } from "node:fs/promises";

import { isMcpServersMap } from "./mcp-config.js";
import type { AgentScenario, AgentSuiteFile } from "./types.js";

export async function loadSuiteFile(path: string): Promise<AgentSuiteFile> {
	const raw = await readFile(path, "utf8");
	const parsed: unknown = JSON.parse(raw);
	if (!isSuiteFile(parsed)) {
		throw new Error(`Invalid suite file: ${path}`);
	}
	return parsed;
}

function isScenario(value: unknown): value is AgentScenario {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const scenario = value as AgentScenario;
	if (
		typeof scenario.name !== "string" ||
		typeof scenario.prompt !== "string" ||
		typeof scenario.rubric !== "object" ||
		scenario.rubric === null
	) {
		return false;
	}
	if (
		scenario.mcpServers !== undefined &&
		!isMcpServersMap(scenario.mcpServers)
	) {
		return false;
	}
	return true;
}

function isSuiteFile(value: unknown): value is AgentSuiteFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const suite = value as AgentSuiteFile;
	if (typeof suite.name !== "string" || !Array.isArray(suite.scenarios)) {
		return false;
	}
	if (
		suite.defaults?.mcpServers !== undefined &&
		!isMcpServersMap(suite.defaults.mcpServers)
	) {
		return false;
	}
	return suite.scenarios.every(isScenario);
}
