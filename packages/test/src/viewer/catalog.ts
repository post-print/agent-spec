import type { AgentHost, ContextMode } from "@post-print/agent-harness";
import type { CompareGate, CompareJudgeMetric, ScenarioRubric } from "../types.js";
export interface ViewerCatalogArm {
	id: string;
	label: string;
	description?: string;
	prompt: string;
	rubric: ScenarioRubric;
	contextMode?: ContextMode;
	/** Repository-relative source folder copied into this arm's sealed workspace. */
	workspace?: string;
	contextSources?: string[];
	suppliedMcp?: ViewerSuppliedMcpServer[];
	suppliedSkills?: string[];
}

export interface ViewerSuppliedMcpServer {
	name: string;
	tools: string[];
}

export interface ViewerCatalogScenario {
	authoring?: "typescript";
	name: string;
	description?: string;
	prompt: string;
	skip?: boolean;
	host?: AgentHost;
	contextMode?: ContextMode;
	/** Repository-relative source folder copied into the sealed workspace. */
	workspace?: string;
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

export interface ViewerRunRequest {
	suite?: string;
	scenario?: string;
	hosts?: AgentHost[];
	parallelHosts?: boolean;
	/** Maximum concurrent agent jobs for this run. */
	workers?: number;
}

export interface ViewerJob {
	suite: string;
	scenario: string;
	host: AgentHost;
	arm?: string;
	prompt: string;
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
			jobs.push(...scenarioJobs(suite.name, scenario, hosts));
		}
	}
	return jobs;
}

function scenarioJobs(
	suite: string,
	scenario: ViewerCatalogScenario,
	hosts: AgentHost[],
): ViewerJob[] {
	const jobs: ViewerJob[] = [];
	for (const host of hosts) {
		if (scenario.host && scenario.host !== host) {
			continue;
		}
		if (scenario.compare?.length) {
			for (const arm of scenario.compare) {
				jobs.push({
					suite: suite,
					scenario: scenario.name,
					host,
					arm: arm.id,
					prompt: arm.prompt ?? scenario.prompt,
				});
			}
			continue;
		}
		jobs.push({
			suite: suite,
			scenario: scenario.name,
			host,
			prompt: scenario.prompt,
		});
	}
	return jobs;
}
