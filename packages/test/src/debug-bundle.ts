import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTrace } from "@post-print/agent-harness";

import { scenarioArtifactSlug } from "./record-trace.js";
import type {
	AgentScenario,
	AssertionFailure,
	JudgeVerdictResult,
	ScenarioResult,
} from "./types.js";

export interface DebugRerunOptions {
	cliPath: string;
	cwd: string;
	suitesDir: string;
	suite: string;
	scenario: string;
	live: boolean;
	host?: string;
	judge?: boolean;
	worktree?: boolean;
	timeoutMs?: number;
	noTimeout?: boolean;
	allowUserInput?: boolean;
	debugDir?: string;
	keepRecordings?: boolean;
}

export interface DebugEnvironmentSnapshot {
	nodeVersion: string;
	bunVersion?: string;
	packageVersion: string;
	host?: string;
	suite: string;
	scenario: string;
	cursorApiKeySet: boolean;
	cursorAgentModel?: string;
	cursorJudgeModel?: string;
	cursorJudgeTemperature?: string;
	timeoutMs?: number;
	worktree?: boolean;
	isolateLive?: boolean;
	agentTestEnv: Record<string, string | undefined>;
}

export interface WriteDebugBundleOptions {
	dir: string;
	result: ScenarioResult;
	trace?: AgentTrace;
	scenario: AgentScenario;
	environment: DebugEnvironmentSnapshot;
	rerun: DebugRerunOptions;
}

const AGENT_TEST_ENV_KEYS = [
	"AGENT_TEST_VERBOSE",
	"AGENT_TEST_VERBOSE_PATHS",
	"AGENT_TEST_QUIET",
	"AGENT_TEST_TIMEOUT_MS",
	"AGENT_TEST_ALLOW_IN_PLACE",
	"AGENT_TEST_NO_WORKTREE",
	"AGENT_TEST_NO_ISOLATE",
	"AGENT_TEST_SCENARIO_SETTLE_MS",
	"AGENT_TEST_DEBUG",
	"AGENT_TEST_CHILD",
] as const;

/** Shell-quote a single argument for POSIX sh. */
export function shellQuote(value: string): string {
	if (value.length === 0) {
		return "''";
	}
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRerunCommand(options: DebugRerunOptions): string {
	const args = [options.cliPath];
	if (options.live) {
		args.push("--live");
	}
	args.push(
		"--suites-dir",
		options.suitesDir,
		"--suite",
		options.suite,
		"--scenario",
		options.scenario,
	);
	if (options.host) {
		args.push("--host", options.host);
	}
	if (options.judge === false) {
		args.push("--no-judge");
	} else if (options.judge === true && !options.live) {
		args.push("--judge");
	}
	if (options.worktree === false) {
		args.push("--no-worktree");
	}
	if (options.noTimeout) {
		args.push("--no-timeout");
	} else if (options.timeoutMs !== undefined) {
		args.push("--timeout-ms", String(options.timeoutMs));
	}
	if (options.allowUserInput) {
		args.push("--allow-user-input");
	}
	args.push("--debug");
	if (options.debugDir) {
		args.push("--debug-dir", options.debugDir);
	}
	if (options.keepRecordings !== false) {
		args.push("--keep-recordings");
	}
	return [shellQuote(process.execPath), ...args.map(shellQuote)].join(" ");
}

export function collectDebugEnvironment(options: {
	suite: string;
	scenario: string;
	packageVersion: string;
	host?: string;
	timeoutMs?: number;
	worktree?: boolean;
	isolateLive?: boolean;
}): DebugEnvironmentSnapshot {
	const agentTestEnv: Record<string, string | undefined> = {};
	for (const key of AGENT_TEST_ENV_KEYS) {
		const value = process.env[key];
		if (value !== undefined) {
			agentTestEnv[key] = value;
		}
	}
	return {
		nodeVersion: process.versions.node,
		bunVersion: process.versions.bun,
		packageVersion: options.packageVersion,
		host: options.host,
		suite: options.suite,
		scenario: options.scenario,
		cursorApiKeySet: Boolean(process.env.CURSOR_API_KEY?.trim()),
		cursorAgentModel: process.env.CURSOR_AGENT_MODEL,
		cursorJudgeModel: process.env.CURSOR_JUDGE_MODEL,
		cursorJudgeTemperature: process.env.CURSOR_JUDGE_TEMPERATURE,
		timeoutMs: options.timeoutMs,
		worktree: options.worktree,
		isolateLive: options.isolateLive,
		agentTestEnv,
	};
}

function compactToolArgs(input: unknown): string {
	if (input === undefined) {
		return "";
	}
	const raw = typeof input === "string" ? input : JSON.stringify(input);
	if (raw.length <= 160) {
		return raw;
	}
	return `${raw.slice(0, 160)}…`;
}

export function formatTranscriptMarkdown(options: {
	scenario: AgentScenario;
	trace?: AgentTrace;
	failures: AssertionFailure[];
	judgeVerdicts?: JudgeVerdictResult[];
}): string {
	const lines: string[] = [
		`# ${options.scenario.name}`,
		"",
		"## Prompt",
		"",
		"```",
		options.scenario.prompt,
		"```",
		"",
		"## Transcript",
		"",
	];

	const trace = options.trace;
	if (!trace) {
		lines.push("_No trace available._", "");
	} else {
		if (trace.routing) {
			lines.push("### Routing", "", "```json", JSON.stringify(trace.routing, null, 2), "```", "");
		}

		type Event =
			| { kind: "message"; seq: number; message: (typeof trace.messages)[number] }
			| { kind: "tool"; seq: number; tool: (typeof trace.toolCalls)[number] };

		const events: Event[] = [
			...trace.messages.map((message, index) => ({
				kind: "message" as const,
				seq: message.seq ?? index,
				message,
			})),
			...trace.toolCalls.map((tool, index) => ({
				kind: "tool" as const,
				seq: tool.seq ?? 10_000 + index,
				tool,
			})),
		].sort((a, b) => a.seq - b.seq);

		for (const event of events) {
			if (event.kind === "message") {
				lines.push(`### ${event.message.role}`, "", event.message.content, "");
			} else {
				lines.push(
					`### tool: ${event.tool.name}`,
					"",
					"```",
					compactToolArgs(event.tool.args),
					"```",
					"",
				);
			}
		}

		if (trace.shellCommands.length > 0) {
			lines.push("### Shell commands", "");
			for (const cmd of trace.shellCommands) {
				lines.push(`- \`${cmd}\``);
			}
			lines.push("");
		}
	}

	if (options.judgeVerdicts?.length) {
		lines.push("## Judge", "");
		for (const verdict of options.judgeVerdicts) {
			const mark = verdict.pass ? "PASS" : "FAIL";
			lines.push(`### ${mark} \`${verdict.id}\``, "", verdict.question, "", verdict.rationale, "");
			if (verdict.infraError) {
				lines.push(`**infraError:** ${verdict.infraError}`, "");
			}
		}
	}

	if (options.failures.length > 0) {
		lines.push("## Failures", "");
		for (const failure of options.failures) {
			lines.push(`- **${failure.category}** \`${failure.matcher}\`: ${failure.message}`);
			if (failure.evidence) {
				lines.push(`  - evidence: ${failure.evidence}`);
			}
		}
		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

export function getDebugBundleDir(
	stagingSessionId: string,
	suiteName: string,
	scenarioName: string,
	getSessionRoot: (sessionId: string) => string,
): string {
	return join(
		getSessionRoot(stagingSessionId),
		suiteName,
		`${scenarioArtifactSlug(scenarioName)}.debug`,
	);
}

/** Persist a failed-scenario debug bundle (trace, failures, transcript, judge, env, rerun). */
export async function writeDebugBundle(options: WriteDebugBundleOptions): Promise<string> {
	const { dir, result, trace, scenario, environment, rerun } = options;
	await mkdir(dir, { recursive: true });

	const failuresPath = join(dir, "failures.json");
	const transcriptPath = join(dir, "transcript.md");
	const environmentPath = join(dir, "environment.json");
	const rerunPath = join(dir, "rerun.sh");

	await writeFile(failuresPath, `${JSON.stringify(result.failures, null, 2)}\n`, "utf8");
	await writeFile(
		transcriptPath,
		formatTranscriptMarkdown({
			scenario,
			trace,
			failures: result.failures,
			judgeVerdicts: result.judgeVerdicts,
		}),
		"utf8",
	);
	await writeFile(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");

	if (trace) {
		const payload = {
			messages: trace.messages,
			toolCalls: trace.toolCalls,
			shellCommands: trace.shellCommands,
			gitDiff: trace.gitDiff,
			prBody: trace.prBody,
			artifacts: trace.artifacts,
			routing: trace.routing,
			skillsInvoked: trace.skillsInvoked,
			assistantTextBeforeTools: trace.assistantTextBeforeTools,
			judgeVerdicts: trace.judgeVerdicts,
		};
		await writeFile(join(dir, "trace.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	}

	if (result.judgeVerdicts?.length) {
		await writeFile(
			join(dir, "judge-debug.json"),
			`${JSON.stringify(result.judgeVerdicts, null, 2)}\n`,
			"utf8",
		);
	}

	const rerunBody = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`# Re-run failed scenario ${scenario.name}`,
		`# Requires CURSOR_API_KEY in the environment for --live.`,
		`cd ${shellQuote(rerun.cwd)}`,
		buildRerunCommand(rerun),
		"",
	].join("\n");
	await writeFile(rerunPath, rerunBody, "utf8");
	await chmod(rerunPath, 0o755);

	return dir;
}
