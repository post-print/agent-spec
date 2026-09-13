import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { type AgentHost, isAgentHost } from "@post-print/agent-harness";

import { discoverSuites } from "./discover-suites.js";
import { missingAgentAuth, runDoctor } from "./doctor.js";
import { loadSuiteFile } from "./load-suite.js";
import { formatSeedValidationReport, validateSeedPatches } from "./validate-seeds.js";
import { formatValidationReport, validateSuitePaths } from "./validate-suite.js";

export interface CheckOptions {
	cwd: string;
	suitesDir: string;
	filter?: string;
	rubricsDir?: string;
	/** CLI host override. Wins over suite defaults when set. */
	host?: AgentHost;
	cliPath?: string;
}

export interface CheckReport {
	/** Package, suite, and seed checks passed. Host readiness is separate. */
	ok: boolean;
	packageOk: boolean;
	suiteOk: boolean;
	seedsOk: boolean;
	hostReady: boolean;
	hosts: AgentHost[];
	messages: string[];
}

function filterSuitePaths(suitePaths: string[], filter?: string): string[] {
	if (!filter) {
		return suitePaths;
	}
	return suitePaths.filter(
		(path) => path.includes(`/${filter}/`) || path.endsWith(`/${filter}/scenarios.json`),
	);
}

async function suitesDirExists(cwd: string, suitesDir: string): Promise<boolean> {
	try {
		await access(resolve(cwd, suitesDir));
		return true;
	} catch {
		return false;
	}
}

/** Hosts a live run will launch after suite defaults and an optional CLI override. */
export async function collectSuiteHosts(options: {
	cwd: string;
	suitesDir: string;
	filter?: string;
	rubricsDir?: string;
	host?: AgentHost;
}): Promise<AgentHost[]> {
	if (options.host) {
		return [options.host];
	}
	const root = resolve(options.cwd, options.suitesDir);
	let suitePaths: string[] = [];
	try {
		suitePaths = filterSuitePaths(await discoverSuites(root), options.filter);
	} catch {
		return ["cursor"];
	}
	const hosts = new Set<AgentHost>();
	for (const suitePath of suitePaths) {
		try {
			const suite = await loadSuiteFile(suitePath, { rubricsDir: options.rubricsDir });
			const fallback = suite.defaults?.host ?? "cursor";
			for (const scenario of suite.scenarios) {
				if (scenario.skip) {
					continue;
				}
				const host = scenario.host ?? fallback;
				if (isAgentHost(host)) {
					hosts.add(host);
				}
			}
			if (suite.scenarios.length === 0 && isAgentHost(fallback)) {
				hosts.add(fallback);
			}
		} catch {
			// Invalid files are reported by suite validation.
		}
	}
	if (hosts.size === 0) {
		return ["cursor"];
	}
	return [...hosts];
}

/** Missing auth for every host this run will launch. Undefined when all hosts are ready. */
export function missingHostsAuth(hosts: readonly AgentHost[]): string | undefined {
	const missing = hosts.map((host) => missingAgentAuth(host)).filter((message) => message);
	return missing[0];
}

/** Suite, seed, package, and host checks. Does not launch an agent. */
export async function runCheck(options: CheckOptions): Promise<CheckReport> {
	const messages: string[] = [];
	const doctor = runDoctor({ cliPath: options.cliPath });
	messages.push("package");
	for (const message of doctor.messages) {
		messages.push(`  ${message}`);
	}

	const hosts = await collectSuiteHosts(options);
	const hostError = missingHostsAuth(hosts);
	const hostReady = hostError === undefined;
	messages.push("host");
	messages.push(`  ${hosts.join(", ")}: ${hostReady ? "ready" : (hostError ?? "not ready")}`);

	let suiteOk = false;
	const suitesRoot = resolve(options.cwd, options.suitesDir);
	if (!(await suitesDirExists(options.cwd, options.suitesDir))) {
		messages.push("suite");
		messages.push(`  missing ${suitesRoot}`);
	} else {
		const suitePaths = filterSuitePaths(await discoverSuites(suitesRoot), options.filter);
		if (suitePaths.length === 0) {
			messages.push("suite");
			messages.push(`  No suites found under ${options.suitesDir}`);
		} else {
			const suiteReport = await validateSuitePaths(suitePaths, {
				validatePaths: true,
				repoRoot: options.cwd,
				rubricsDir: options.rubricsDir,
			});
			suiteOk = suiteReport.ok;
			messages.push("suite");
			for (const line of formatValidationReport(suiteReport).split("\n")) {
				messages.push(`  ${line}`);
			}
		}
	}

	const seedReport = await validateSeedPatches({
		cwd: options.cwd,
		suitesDir: options.suitesDir,
		rubricsDir: options.rubricsDir,
		filter: options.filter,
	}).catch((error: unknown) => ({
		ok: false,
		issues: [
			{
				suite: options.suitesDir,
				scenario: "*",
				seedPatch: "",
				message: error instanceof Error ? error.message : String(error),
			},
		],
		checked: 0,
	}));
	const seedsOk = seedReport.ok;
	messages.push("seeds");
	for (const line of formatSeedValidationReport(seedReport).split("\n")) {
		messages.push(`  ${line}`);
	}

	return {
		ok: doctor.ok && suiteOk && seedsOk,
		packageOk: doctor.ok,
		suiteOk,
		seedsOk,
		hostReady,
		hosts,
		messages,
	};
}

export function formatCheckReport(report: CheckReport): string {
	return ["agent-test check", ...report.messages].join("\n");
}

export function formatCheckSummary(report: CheckReport): string {
	const suite = report.suiteOk ? "suite ok" : "suite failed";
	const pkg = report.packageOk ? "package ok" : "package failed";
	const host = report.hostReady
		? `host ${report.hosts.join(",")} ready`
		: `host ${report.hosts.join(",")} not ready`;
	return `check  ${pkg} · ${suite} · ${host}`;
}
