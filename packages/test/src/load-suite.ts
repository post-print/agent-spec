import { readFile } from "node:fs/promises";

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
	return (
		typeof scenario.name === "string" &&
		typeof scenario.prompt === "string" &&
		typeof scenario.rubric === "object" &&
		scenario.rubric !== null
	);
}

function isSuiteFile(value: unknown): value is AgentSuiteFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const suite = value as AgentSuiteFile;
	return (
		typeof suite.name === "string" &&
		Array.isArray(suite.scenarios) &&
		suite.scenarios.every(isScenario)
	);
}
