import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentHost, ContextProfile, SkillContextSetting } from "@post-print/agent-harness";

import { loadSuiteFile } from "./load-suite.js";
import type { AgentScenario, AgentSuiteFile, ScenarioRubric } from "./types.js";

const VALID_HOSTS = new Set<AgentHost>(["cursor", "claude", "replay"]);
const VALID_PROFILES = new Set<ContextProfile>(["shared", "cursor", "claude", "skeleton"]);
const VALID_SKILLS = new Set<SkillContextSetting>(["none", "catalog", "full"]);
const VALID_TIERS = new Set<NonNullable<ScenarioRubric["tier"]>>(["low", "medium", "high"]);
const VALID_REVIEW_DEPTHS = new Set<NonNullable<ScenarioRubric["reviewDepth"]>>([
	"quick",
	"standard",
	"thorough",
	"full",
]);

export interface SuiteValidationIssue {
	suitePath: string;
	scenario?: string;
	field: string;
	message: string;
}

export interface SuiteValidationReport {
	ok: boolean;
	issues: SuiteValidationIssue[];
	suitesChecked: number;
	scenariosChecked: number;
}

function pushIssue(
	issues: SuiteValidationIssue[],
	suitePath: string,
	field: string,
	message: string,
	scenario?: string,
): void {
	issues.push({ suitePath, scenario, field, message });
}

function validateRubric(
	issues: SuiteValidationIssue[],
	suitePath: string,
	scenarioName: string,
	rubric: ScenarioRubric,
): void {
	if (rubric.tier !== undefined && !VALID_TIERS.has(rubric.tier)) {
		pushIssue(
			issues,
			suitePath,
			"rubric.tier",
			`tier must be low|medium|high, got ${JSON.stringify(rubric.tier)}`,
			scenarioName,
		);
	}
	if (rubric.reviewDepth !== undefined && !VALID_REVIEW_DEPTHS.has(rubric.reviewDepth)) {
		pushIssue(
			issues,
			suitePath,
			"rubric.reviewDepth",
			`reviewDepth must be quick|standard|thorough|full, got ${JSON.stringify(rubric.reviewDepth)}`,
			scenarioName,
		);
	}
	for (const key of [
		"must",
		"mustNot",
		"mustRun",
		"mustCallTool",
		"mustNotCallTool",
		"mustReadPath",
		"mustNotReadPath",
	] as const) {
		const value = rubric[key];
		if (value !== undefined && !Array.isArray(value)) {
			pushIssue(
				issues,
				suitePath,
				`rubric.${key}`,
				`${key} must be an array of strings`,
				scenarioName,
			);
		}
	}
	for (const key of ["mustInvokeSkill", "mustNotInvokeSkill"] as const) {
		const value = rubric[key];
		if (value !== undefined && !Array.isArray(value)) {
			pushIssue(
				issues,
				suitePath,
				`rubric.${key}`,
				`${key} must be an array of skill folder names`,
				scenarioName,
			);
		}
	}
	if (rubric.judge !== undefined) {
		if (!Array.isArray(rubric.judge)) {
			pushIssue(
				issues,
				suitePath,
				"rubric.judge",
				"judge must be an array of strings or { question } objects",
				scenarioName,
			);
		} else {
			for (const [index, item] of rubric.judge.entries()) {
				if (typeof item === "string") {
					continue;
				}
				if (typeof item !== "object" || item === null || typeof item.question !== "string") {
					pushIssue(
						issues,
						suitePath,
						`rubric.judge[${index}]`,
						"judge item must be a string or { question: string }",
						scenarioName,
					);
				}
			}
		}
	}
}

function validateScenario(
	issues: SuiteValidationIssue[],
	suitePath: string,
	scenario: AgentScenario,
): void {
	if (scenario.host !== undefined && !VALID_HOSTS.has(scenario.host)) {
		pushIssue(
			issues,
			suitePath,
			"host",
			`host must be cursor|claude|replay, got ${JSON.stringify(scenario.host)}`,
			scenario.name,
		);
	}
	if (scenario.profile !== undefined && !VALID_PROFILES.has(scenario.profile)) {
		pushIssue(
			issues,
			suitePath,
			"profile",
			`profile must be shared|cursor|claude|skeleton, got ${JSON.stringify(scenario.profile)}`,
			scenario.name,
		);
	}
	if (scenario.contextSources !== undefined && !Array.isArray(scenario.contextSources)) {
		pushIssue(
			issues,
			suitePath,
			"contextSources",
			"contextSources must be an array of strings",
			scenario.name,
		);
	}
	if (scenario.skills !== undefined && !VALID_SKILLS.has(scenario.skills)) {
		pushIssue(
			issues,
			suitePath,
			"skills",
			`skills must be none|catalog|full, got ${JSON.stringify(scenario.skills)}`,
			scenario.name,
		);
	}
	if (scenario.seedStageOnly && !scenario.seedPatch) {
		pushIssue(
			issues,
			suitePath,
			"seedStageOnly",
			"seedStageOnly requires seedPatch",
			scenario.name,
		);
	}
	validateRubric(issues, suitePath, scenario.name, scenario.rubric);
}

function validateDefaults(
	issues: SuiteValidationIssue[],
	suitePath: string,
	suite: AgentSuiteFile,
): void {
	const defaults = suite.defaults;
	if (!defaults) {
		return;
	}
	if (defaults.host !== undefined && !VALID_HOSTS.has(defaults.host)) {
		pushIssue(
			issues,
			suitePath,
			"defaults.host",
			`host must be cursor|claude|replay, got ${JSON.stringify(defaults.host)}`,
		);
	}
	if (defaults.profile !== undefined && !VALID_PROFILES.has(defaults.profile)) {
		pushIssue(
			issues,
			suitePath,
			"defaults.profile",
			`profile must be shared|cursor|claude|skeleton, got ${JSON.stringify(defaults.profile)}`,
		);
	}
	if (defaults.contextSources !== undefined && !Array.isArray(defaults.contextSources)) {
		pushIssue(
			issues,
			suitePath,
			"defaults.contextSources",
			"contextSources must be an array of strings",
		);
	}
	if (defaults.skills !== undefined && !VALID_SKILLS.has(defaults.skills)) {
		pushIssue(
			issues,
			suitePath,
			"defaults.skills",
			`skills must be none|catalog|full, got ${JSON.stringify(defaults.skills)}`,
		);
	}
}

/** Semantic validation beyond structural loadSuiteFile checks. */
export function validateSuiteFile(
	suitePath: string,
	suite: AgentSuiteFile,
): SuiteValidationIssue[] {
	const issues: SuiteValidationIssue[] = [];
	validateDefaults(issues, suitePath, suite);
	for (const scenario of suite.scenarios) {
		validateScenario(issues, suitePath, scenario);
	}
	return issues;
}

export async function validateSuitePaths(
	suitePaths: string[],
	options?: { validatePaths?: boolean; repoRoot?: string },
): Promise<SuiteValidationReport> {
	const issues: SuiteValidationIssue[] = [];
	let scenariosChecked = 0;
	const repoRoot = options?.repoRoot;

	for (const suitePath of suitePaths) {
		let suite: AgentSuiteFile;
		try {
			suite = await loadSuiteFile(suitePath);
		} catch (error) {
			pushIssue(
				issues,
				suitePath,
				"file",
				error instanceof Error ? error.message : "failed to load suite file",
			);
			continue;
		}
		issues.push(...validateSuiteFile(suitePath, suite));
		scenariosChecked += suite.scenarios.length;

		if (options?.validatePaths && repoRoot) {
			for (const scenario of suite.scenarios) {
				if (scenario.replayTrace) {
					const replayPath = resolve(repoRoot, scenario.replayTrace);
					try {
						await access(replayPath);
					} catch {
						pushIssue(
							issues,
							suitePath,
							"replayTrace",
							`replay trace not found: ${scenario.replayTrace}`,
							scenario.name,
						);
					}
				}
				if (scenario.seedPatch) {
					const patchPath = resolve(repoRoot, scenario.seedPatch);
					try {
						await access(patchPath);
					} catch {
						pushIssue(
							issues,
							suitePath,
							"seedPatch",
							`seed patch not found: ${scenario.seedPatch}`,
							scenario.name,
						);
					}
				}
			}
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		suitesChecked: suitePaths.length,
		scenariosChecked,
	};
}

export function formatValidationReport(report: SuiteValidationReport): string {
	if (report.ok) {
		return `Validated ${report.suitesChecked} suite(s), ${report.scenariosChecked} scenario(s): OK`;
	}
	const lines = report.issues.map((issue) => {
		const where = issue.scenario ? `${issue.suitePath} · ${issue.scenario}` : issue.suitePath;
		return `${where} · ${issue.field}: ${issue.message}`;
	});
	return [
		`Validation failed (${report.issues.length} issue(s)):`,
		...lines.map((l) => `  - ${l}`),
	].join("\n");
}
