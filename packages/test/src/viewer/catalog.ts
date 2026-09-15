import { resolve } from "node:path";

import {
	type AgentHost,
	type ContextMode,
	type McpServerConfig,
	mergeMcpServers,
	skillPathsFromSetting,
} from "@post-print/agent-harness";

import {
	applyCompareArm,
	compareArmDescription,
	compareArmLabel,
	resolveCompareArms,
} from "../compare-scenario.js";
import { discoverSuites } from "../discover-suites.js";
import { resolveSuiteHosts } from "../hosts.js";
import { loadSuiteFile } from "../load-suite.js";
import type { CompareGate, CompareJudgeMetric, ScenarioRubric } from "../types.js";

export interface ViewerCatalogArm {
	id: string;
	label: string;
	description?: string;
	prompt: string;
	rubric: ScenarioRubric;
	contextMode?: ContextMode;
	contextSources?: string[];
	suppliedMcp?: ViewerSuppliedMcpServer[];
	suppliedSkills?: string[];
}

export interface ViewerSuppliedMcpServer {
	name: string;
	tools: string[];
}

export interface ViewerCatalogScenario {
	name: string;
	description?: string;
	prompt: string;
	skip?: boolean;
	host?: AgentHost;
	contextMode?: ContextMode;
	rubric: ScenarioRubric;
	compare?: ViewerCatalogArm[];
	gates?: CompareGate[];
	judgeMetrics?: CompareJudgeMetric[];
	contextSources?: string[];
	suppliedMcp?: ViewerSuppliedMcpServer[];
	suppliedSkills?: string[];
}

export interface ViewerCatalogSuite {
	name: string;
	description?: string;
	hosts: AgentHost[];
	scenarios: ViewerCatalogScenario[];
}

export interface ViewerCatalog {
	suitesDir: string;
	defaultSelectedHosts: AgentHost[];
	suites: ViewerCatalogSuite[];
}

export interface LoadViewerCatalogOptions {
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
}

export interface ViewerRunRequest {
	suite?: string;
	scenario?: string;
	hosts?: AgentHost[];
	parallelHosts?: boolean;
}

export interface ViewerJob {
	suite: string;
	scenario: string;
	host: AgentHost;
	arm?: string;
	prompt: string;
}

function suppliedMcp(
	defaults: Record<string, McpServerConfig> | undefined,
	overrides: Record<string, McpServerConfig> | undefined,
): ViewerSuppliedMcpServer[] | undefined {
	const servers = mergeMcpServers(defaults, overrides);
	if (!servers) return undefined;
	return Object.entries(servers).map(([name, config]) => ({
		name,
		tools: [...(config.tools ?? [])],
	}));
}

function suppliedSkills(
	setting: Parameters<typeof skillPathsFromSetting>[0],
): string[] | undefined {
	const paths = skillPathsFromSetting(setting);
	return paths.length > 0 ? paths : undefined;
}

/** Load suite JSON for the viewer. Omit MCP server env and other secrets. */
export async function loadViewerCatalog(options: LoadViewerCatalogOptions): Promise<ViewerCatalog> {
	const suitesDir = resolve(options.cwd, options.suitesDir);
	const suitePaths = await discoverSuites(suitesDir);
	const suites: ViewerCatalogSuite[] = [];
	for (const suitePath of suitePaths) {
		const suite = await loadSuiteFile(suitePath, { rubricsDir: options.rubricsDir });
		suites.push({
			name: suite.name,
			description: suite.description,
			hosts: resolveSuiteHosts({
				suiteHosts: suite.hosts,
				defaultHost: suite.defaults?.host,
			}),
			scenarios: suite.scenarios.map((scenario) => {
				const arms = resolveCompareArms(scenario.compare).map((entry) => {
					const effective = applyCompareArm(scenario, entry.id);
					const armRubric = { ...effective.rubric };
					delete armRubric.judge;
					const arm: ViewerCatalogArm = {
						id: entry.id,
						label: compareArmLabel(entry.arm, entry.id),
						prompt: effective.prompt,
						// Compare judge questions are owned by the comparison, even though
						// isolated arm execution temporarily merges them into this rubric.
						rubric: armRubric,
						contextMode:
							entry.arm.contextMode ??
							scenario.contextMode ??
							suite.defaults?.contextMode ??
							"harness-preamble",
					};
					const description = compareArmDescription(entry.arm);
					if (description) {
						arm.description = description;
					}
					const contextSources = [
						...(suite.defaults?.contextSources ?? []),
						...(effective.contextSources ?? []),
					].filter((value) => typeof value === "string" && value.trim().length > 0);
					if (contextSources.length > 0) {
						arm.contextSources = contextSources;
					}
					arm.suppliedMcp = suppliedMcp(suite.defaults?.mcpServers, effective.mcpServers);
					arm.suppliedSkills = suppliedSkills(effective.skills ?? suite.defaults?.skills);
					return arm;
				});
				const row: ViewerCatalogScenario = {
					name: scenario.name,
					prompt: scenario.prompt,
					rubric: scenario.rubric,
					contextMode: scenario.contextMode ?? suite.defaults?.contextMode ?? "harness-preamble",
				};
				if (scenario.description) {
					row.description = scenario.description;
				}
				if (scenario.skip) {
					row.skip = true;
				}
				if (scenario.host) {
					row.host = scenario.host;
				}
				const contextSources = [
					...(suite.defaults?.contextSources ?? []),
					...(scenario.contextSources ?? []),
				].filter((value) => typeof value === "string" && value.trim().length > 0);
				if (contextSources.length > 0) {
					row.contextSources = contextSources;
				}
				row.suppliedMcp = suppliedMcp(suite.defaults?.mcpServers, scenario.mcpServers);
				row.suppliedSkills = suppliedSkills(scenario.skills ?? suite.defaults?.skills);
				if (arms.length > 0) {
					row.compare = arms;
					if (scenario.compare?.gates?.length) row.gates = scenario.compare.gates;
					if (scenario.compare?.judgeMetrics?.length) {
						row.judgeMetrics = scenario.compare.judgeMetrics;
					}
				}
				return row;
			}),
		});
	}
	suites.sort((left, right) => left.name.localeCompare(right.name));
	return {
		suitesDir,
		defaultSelectedHosts: [],
		suites,
	};
}

/** Expand a viewer run into one job per host cell, or per compare arm. */
export function expandViewerJobs(catalog: ViewerCatalog, request: ViewerRunRequest): ViewerJob[] {
	const selectedHosts = request.hosts ?? catalog.defaultSelectedHosts;
	const suites = request.suite
		? catalog.suites.filter((suite) => suite.name === request.suite)
		: catalog.suites;
	const jobs: ViewerJob[] = [];
	for (const suite of suites) {
		const hosts = selectedHosts.filter((host) => suite.hosts.includes(host));
		const scenarios = request.scenario
			? suite.scenarios.filter((scenario) => scenario.name === request.scenario)
			: suite.scenarios;
		for (const scenario of scenarios) {
			if (scenario.skip) {
				continue;
			}
			for (const host of hosts) {
				if (scenario.host && scenario.host !== host) {
					continue;
				}
				if (scenario.compare && scenario.compare.length > 0) {
					for (const arm of scenario.compare) {
						jobs.push({
							suite: suite.name,
							scenario: scenario.name,
							host,
							arm: arm.id,
							prompt: arm.prompt ?? scenario.prompt,
						});
					}
					continue;
				}
				jobs.push({
					suite: suite.name,
					scenario: scenario.name,
					host,
					prompt: scenario.prompt,
				});
			}
		}
	}
	return jobs;
}
