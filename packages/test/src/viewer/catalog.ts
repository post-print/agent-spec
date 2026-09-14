import { resolve } from "node:path";

import type { AgentHost } from "@post-print/agent-harness";

import { compareArmDescription, compareArmLabel, resolveCompareArms } from "../compare-scenario.js";
import { discoverSuites } from "../discover-suites.js";
import { resolveSuiteHosts } from "../hosts.js";
import { loadSuiteFile } from "../load-suite.js";
import type { ScenarioRubric } from "../types.js";

export interface ViewerCatalogArm {
	id: string;
	label: string;
	description?: string;
	prompt?: string;
}

export interface ViewerCatalogScenario {
	name: string;
	description?: string;
	prompt: string;
	skip?: boolean;
	host?: AgentHost;
	rubric: ScenarioRubric;
	compare?: ViewerCatalogArm[];
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
					const arm: ViewerCatalogArm = {
						id: entry.id,
						label: compareArmLabel(entry.arm, entry.id),
					};
					const description = compareArmDescription(entry.arm);
					if (description) {
						arm.description = description;
					}
					const prompt = entry.arm.prompt?.trim();
					if (prompt) {
						arm.prompt = prompt;
					}
					return arm;
				});
				const row: ViewerCatalogScenario = {
					name: scenario.name,
					prompt: scenario.prompt,
					rubric: scenario.rubric,
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
				if (arms.length > 0) {
					row.compare = arms;
				}
				return row;
			}),
		});
	}
	suites.sort((left, right) => left.name.localeCompare(right.name));
	return {
		suitesDir,
		defaultSelectedHosts: ["cursor"],
		suites,
	};
}

/** Expand a viewer run into one job per host cell, or per compare arm. */
export function expandViewerJobs(catalog: ViewerCatalog, request: ViewerRunRequest): ViewerJob[] {
	const selectedHosts =
		request.hosts && request.hosts.length > 0 ? request.hosts : catalog.defaultSelectedHosts;
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
