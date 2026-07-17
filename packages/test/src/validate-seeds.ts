import { resolve } from "node:path";

import { createScenarioWorktree } from "@post-print/agent-harness";

import { discoverSuites } from "./discover-suites.js";
import { loadSuiteFile } from "./load-suite.js";
import { seedScenarioWorktree } from "./scenario-seed.js";

export interface SeedValidationIssue {
	suite: string;
	scenario: string;
	seedPatch: string;
	message: string;
}

export interface SeedValidationReport {
	ok: boolean;
	issues: SeedValidationIssue[];
	checked: number;
}

/** Apply each seedPatch in a temp worktree to verify hunks match the current baseline. */
export async function validateSeedPatches(options: {
	cwd: string;
	suitesDir: string;
	filter?: string;
}): Promise<SeedValidationReport> {
	const suitesDir = resolve(options.cwd, options.suitesDir);
	const suitePaths = await discoverSuites(suitesDir);
	const filtered = options.filter
		? suitePaths.filter(
				(path) =>
					path.includes(`/${options.filter}/`) ||
					path.endsWith(`/${options.filter}/scenarios.json`),
			)
		: suitePaths;

	const issues: SeedValidationIssue[] = [];
	let checked = 0;

	for (const suitePath of filtered) {
		const suite = await loadSuiteFile(suitePath);
		for (const scenario of suite.scenarios) {
			if (!scenario.seedPatch) {
				continue;
			}
			checked++;
			try {
				await validateOneSeed(options.cwd, suite.name, scenario.name, scenario.seedPatch, {
					stageOnly: scenario.seedStageOnly,
				});
			} catch (error) {
				issues.push({
					suite: suite.name,
					scenario: scenario.name,
					seedPatch: scenario.seedPatch,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	return { ok: issues.length === 0, issues, checked };
}

async function validateOneSeed(
	repoRoot: string,
	suiteName: string,
	scenarioName: string,
	seedPatch: string,
	options: { stageOnly?: boolean },
): Promise<void> {
	let worktreeHandle: Awaited<ReturnType<typeof createScenarioWorktree>> | undefined;
	try {
		worktreeHandle = await createScenarioWorktree(
			repoRoot,
			`seed-validate-${suiteName}-${scenarioName}`,
		);
		await seedScenarioWorktree(repoRoot, worktreeHandle.path, seedPatch, {
			stageOnly: options.stageOnly,
		});
	} finally {
		if (worktreeHandle) {
			await worktreeHandle.cleanup().catch(() => undefined);
		}
	}
}

export function formatSeedValidationReport(report: SeedValidationReport): string {
	if (report.ok) {
		return `Validated ${report.checked} seed patch(es): OK`;
	}
	const lines = report.issues.map(
		(issue) => `  - ${issue.suite}/${issue.scenario} (${issue.seedPatch}): ${issue.message}`,
	);
	return [`Seed validation failed (${report.issues.length} issue(s)):`, ...lines].join("\n");
}
