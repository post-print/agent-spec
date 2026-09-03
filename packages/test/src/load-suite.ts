import { access, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { isMcpServersMap } from "./mcp-config.js";
import type { AgentScenario, AgentSuiteFile, ScenarioRubric } from "./types.js";

/** External rubrics keyed by scenario name (harness-only; not required on agent-visible paths). */
export interface SuiteRubricsFile {
	scenarios: Record<string, ScenarioRubric>;
}

export interface LoadSuiteOptions {
	/** Explicit rubrics file (wins over discovery). */
	rubricsPath?: string;
	/**
	 * Prefer `<rubricsDir>/<suiteName>/rubrics.json` when present.
	 * Lets answer keys live outside the suites tree / open workspace.
	 */
	rubricsDir?: string;
}

const SIBLING_RUBRIC_NAMES = ["rubrics.json", "scenarios.rubric.json"] as const;

export function suiteNameFromSuitePath(suitePath: string): string {
	return basename(dirname(suitePath));
}

/** Resolve which rubrics file to load, if any. */
export async function resolveRubricsPath(
	suitePath: string,
	options?: LoadSuiteOptions,
): Promise<string | undefined> {
	if (options?.rubricsPath) {
		return resolve(options.rubricsPath);
	}

	const suiteName = suiteNameFromSuitePath(suitePath);
	if (options?.rubricsDir) {
		const fromDir = resolve(options.rubricsDir, suiteName, "rubrics.json");
		if (await pathExists(fromDir)) {
			return fromDir;
		}
	}

	const suiteDir = dirname(suitePath);
	for (const name of SIBLING_RUBRIC_NAMES) {
		const candidate = join(suiteDir, name);
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function parseRubricsFile(parsed: unknown, rubricsPath: string): SuiteRubricsFile {
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`Invalid rubrics file: ${rubricsPath}`);
	}
	const file = parsed as { scenarios?: unknown };
	if (
		typeof file.scenarios !== "object" ||
		file.scenarios === null ||
		Array.isArray(file.scenarios)
	) {
		throw new Error(
			`Invalid rubrics file ${rubricsPath}: expected { "scenarios": { "<name>": { … } } }`,
		);
	}
	const scenarios: Record<string, ScenarioRubric> = {};
	for (const [name, rubric] of Object.entries(file.scenarios)) {
		if (typeof rubric !== "object" || rubric === null || Array.isArray(rubric)) {
			throw new Error(
				`Invalid rubrics file ${rubricsPath}: scenario "${name}" rubric must be an object`,
			);
		}
		scenarios[name] = rubric as ScenarioRubric;
	}
	return { scenarios };
}

/** Apply external rubrics by scenario name (external entry replaces inline rubric). */
export function applyExternalRubrics(
	suite: AgentSuiteFile,
	rubrics: SuiteRubricsFile,
	rubricsPath: string,
): AgentSuiteFile {
	const known = new Set(suite.scenarios.map((s) => s.name));
	const unknown = Object.keys(rubrics.scenarios).filter((name) => !known.has(name));
	if (unknown.length > 0) {
		throw new Error(
			`Rubrics file ${rubricsPath} references unknown scenario(s): ${unknown.join(", ")}`,
		);
	}
	return {
		...suite,
		scenarios: suite.scenarios.map((scenario) => {
			const external = rubrics.scenarios[scenario.name];
			if (external === undefined) {
				return { ...scenario, rubric: scenario.rubric ?? {} };
			}
			return { ...scenario, rubric: external };
		}),
	};
}

export async function loadSuiteFile(
	path: string,
	options?: LoadSuiteOptions,
): Promise<AgentSuiteFile> {
	const raw = await readFile(path, "utf8");
	const parsed: unknown = JSON.parse(raw);
	if (!isSuiteFileShape(parsed)) {
		throw new Error(`Invalid suite file: ${path}`);
	}
	assertNoDeprecatedReplayConfig(parsed, path);
	const normalized: AgentSuiteFile = {
		name: parsed.name,
		description: parsed.description,
		defaults: parsed.defaults,
		scenarios: parsed.scenarios.map((scenario) => ({
			...scenario,
			rubric: scenario.rubric ?? {},
		})),
	};

	const rubricsPath = await resolveRubricsPath(path, options);
	if (!rubricsPath) {
		return normalized;
	}

	let rubricsRaw: string;
	try {
		rubricsRaw = await readFile(rubricsPath, "utf8");
	} catch {
		if (options?.rubricsPath) {
			throw new Error(`Rubrics file not found: ${rubricsPath}`);
		}
		return normalized;
	}

	const rubrics = parseRubricsFile(JSON.parse(rubricsRaw), rubricsPath);
	return applyExternalRubrics(normalized, rubrics, rubricsPath);
}

function assertNoDeprecatedReplayConfig(suite: SuiteFileShape, path: string): void {
	if ((suite.defaults as { host?: unknown } | undefined)?.host === "replay") {
		throw new Error(
			`Invalid suite file ${path}: replay-based testing is deprecated and no longer supported; use Cursor or Claude.`,
		);
	}
	for (const scenario of suite.scenarios) {
		const legacy = scenario as Omit<typeof scenario, "host"> & {
			host?: unknown;
			replayTrace?: unknown;
		};
		if (legacy.host === "replay" || "replayTrace" in legacy) {
			throw new Error(
				`Invalid suite file ${path}: scenario "${scenario.name}" uses replay-based testing, which is deprecated and no longer supported; use Cursor or Claude.`,
			);
		}
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

type SuiteFileShape = {
	name: string;
	description?: string;
	defaults?: AgentSuiteFile["defaults"];
	scenarios: Array<Omit<AgentScenario, "rubric"> & { rubric?: ScenarioRubric }>;
};

/** Structural check for scenarios.json rows (rubric may be omitted before merge/normalize). */
function isScenarioRow(value: unknown): boolean {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const scenario = value as Partial<AgentScenario> & { mcpServers?: unknown };
	if (typeof scenario.name !== "string" || typeof scenario.prompt !== "string") {
		return false;
	}
	if (
		scenario.rubric !== undefined &&
		(typeof scenario.rubric !== "object" || scenario.rubric === null)
	) {
		return false;
	}
	if (scenario.mcpServers !== undefined && !isMcpServersMap(scenario.mcpServers)) {
		return false;
	}
	return true;
}

function isSuiteFileShape(value: unknown): value is SuiteFileShape {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const suite = value as SuiteFileShape;
	if (typeof suite.name !== "string" || !Array.isArray(suite.scenarios)) {
		return false;
	}
	if (suite.defaults?.mcpServers !== undefined && !isMcpServersMap(suite.defaults.mcpServers)) {
		return false;
	}
	return suite.scenarios.every(isScenarioRow);
}
