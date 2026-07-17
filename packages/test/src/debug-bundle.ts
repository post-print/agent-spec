import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentTrace } from "@post-print/agent-harness";

import { scenarioArtifactSlug } from "./record-trace.js";
import type {
	AgentScenario,
	AssertionFailure,
	FailureCategory,
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
	"AGENT_TEST_SCENARIO_RETRIES",
	"AGENT_TEST_DEBUG",
	"AGENT_TEST_CHILD",
] as const;

const TOOL_ARG_COMPACT_CHARS = 500;
const TOOL_RESULT_MAX_CHARS = 4_000;

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

/** Flatten text for a single `# …` shell comment (no newline breakout). */
export function shellCommentText(value: string): string {
	return value.replace(/[\r\n]+/g, " ").trim();
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

function compactText(input: unknown, maxChars: number): string {
	if (input === undefined) {
		return "";
	}
	const raw = typeof input === "string" ? input : JSON.stringify(input);
	if (raw.length <= maxChars) {
		return raw;
	}
	return `${raw.slice(0, maxChars)}…`;
}

function whyHint(category: FailureCategory): string {
	switch (category) {
		case "agent_runtime":
			return "SDK/runtime did not finish cleanly — check raw status, sdkError, and the last tools/messages in the transcript.";
		case "worktree_leak":
			return "Caller checkout changed outside the scenario worktree — inspect porcelain lines and whether Shell ignored worktree cwd.";
		case "judge_infra":
			return "Judge SDK/API failure (not a criterion miss) — retry or check CURSOR_API_KEY / rate limits.";
		case "judge_parse":
			return "Judge returned unparseable JSON — see judge-debug.json and rationale.";
		case "recording_error":
			return "Failed to persist a staging/fixture trace — check disk permissions under the session root.";
		default:
			return "Rubric/judge criterion miss — compare expected rubric in scenario.json to transcript output.";
	}
}

export function formatDebugWhySection(options: {
	result: ScenarioResult;
	trace?: AgentTrace;
}): string[] {
	const lines: string[] = ["## Why", ""];
	if (options.result.passed) {
		lines.push("_Scenario passed._", "");
		return lines;
	}
	if (options.result.failures.length === 0) {
		lines.push("_Failed with no recorded failures._", "");
		return lines;
	}
	for (const [index, failure] of options.result.failures.entries()) {
		lines.push(`### ${index + 1}. \`${failure.category}\` — ${failure.matcher}`, "");
		lines.push(failure.message, "");
		if (failure.evidence) {
			lines.push("```", failure.evidence, "```", "");
		}
		lines.push(`_${whyHint(failure.category)}_`, "");
	}
	const trace = options.trace ?? options.result.trace;
	if (trace) {
		const skills = trace.skillsInvoked?.length ? trace.skillsInvoked.join(", ") : "(none)";
		const usage = options.result.usage ?? trace.usage;
		const usageLine =
			usage?.totalTokens !== undefined
				? `- totalTokens: ${usage.totalTokens}`
				: usage
					? `- usage: in=${usage.inputTokens ?? "?"} out=${usage.outputTokens ?? "?"}`
					: `- totalTokens: (none)`;
		lines.push(
			"**Trace stats:**",
			"",
			`- messages: ${trace.messages.length}`,
			`- toolCalls: ${trace.toolCalls.length}`,
			`- skillsInvoked: ${skills}`,
			`- routing.tier: ${trace.routing?.tier ?? "(none)"}`,
			usageLine,
			"",
		);
	}
	return lines;
}

export function formatDebugSummaryMarkdown(options: {
	scenario: AgentScenario;
	result: ScenarioResult;
	trace?: AgentTrace;
}): string {
	const verdict = options.result.skipped ? "SKIPPED" : options.result.passed ? "PASSED" : "FAILED";
	const lines: string[] = [
		`# ${options.scenario.name}`,
		"",
		`- **verdict:** ${verdict}`,
		`- **durationMs:** ${options.result.durationMs}`,
		`- **failures:** ${options.result.failures.length}`,
		"",
		...formatDebugWhySection({ result: options.result, trace: options.trace }),
	];
	return `${lines.join("\n")}\n`;
}

export function formatTranscriptMarkdown(options: {
	scenario: AgentScenario;
	trace?: AgentTrace;
	failures: AssertionFailure[];
	judgeVerdicts?: JudgeVerdictResult[];
	result?: ScenarioResult;
}): string {
	const result: ScenarioResult = options.result ?? {
		suite: "",
		scenario: options.scenario.name,
		passed: options.failures.length === 0,
		failures: options.failures,
		durationMs: 0,
		judgeVerdicts: options.judgeVerdicts,
		trace: options.trace,
	};

	const lines: string[] = [
		`# ${options.scenario.name}`,
		"",
		...formatDebugWhySection({ result, trace: options.trace }),
		"## Prompt",
		"",
		"```",
		options.scenario.prompt,
		"```",
		"",
		"## Rubric",
		"",
		"```json",
		JSON.stringify(options.scenario.rubric, null, 2),
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
					"**args**",
					"",
					"```",
					compactText(event.tool.args, TOOL_ARG_COMPACT_CHARS),
					"```",
					"",
				);
				if (event.tool.result !== undefined) {
					lines.push(
						"**result**",
						"",
						"```",
						compactText(event.tool.result, TOOL_RESULT_MAX_CHARS),
						"```",
						"",
					);
				}
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
			if (verdict.rawSdkStatus) {
				lines.push(`**rawSdkStatus:** ${verdict.rawSdkStatus}`, "");
			}
			if (verdict.sdkError) {
				lines.push(`**sdkError:** ${JSON.stringify(verdict.sdkError)}`, "");
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

/** Persist a scenario debug bundle (trace, failures, transcript, judge, env, rerun). */
export async function writeDebugBundle(options: WriteDebugBundleOptions): Promise<string> {
	const { dir, result, trace, scenario, environment, rerun } = options;
	await mkdir(dir, { recursive: true });

	const failuresPath = join(dir, "failures.json");
	const transcriptPath = join(dir, "transcript.md");
	const environmentPath = join(dir, "environment.json");
	const rerunPath = join(dir, "rerun.sh");
	const summaryPath = join(dir, "summary.md");
	const scenarioPath = join(dir, "scenario.json");
	const resultPath = join(dir, "result.json");

	const effectiveTrace = trace ?? result.trace;

	await writeFile(failuresPath, `${JSON.stringify(result.failures, null, 2)}\n`, "utf8");
	await writeFile(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
	await writeFile(
		summaryPath,
		formatDebugSummaryMarkdown({ scenario, result, trace: effectiveTrace }),
		"utf8",
	);
	await writeFile(
		scenarioPath,
		`${JSON.stringify(
			{
				name: scenario.name,
				prompt: scenario.prompt,
				rubric: scenario.rubric,
				seedPatch: scenario.seedPatch,
				seedStageOnly: scenario.seedStageOnly,
				replayTrace: scenario.replayTrace,
				host: scenario.host,
				skip: scenario.skip,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	await writeFile(
		resultPath,
		`${JSON.stringify(
			{
				suite: result.suite,
				scenario: result.scenario,
				passed: result.passed,
				skipped: result.skipped,
				durationMs: result.durationMs,
				failures: result.failures,
				usage: result.usage ?? effectiveTrace?.usage,
				skillsInvoked: effectiveTrace?.skillsInvoked ?? [],
				routing: effectiveTrace?.routing,
				messageCount: effectiveTrace?.messages.length ?? 0,
				toolCallCount: effectiveTrace?.toolCalls.length ?? 0,
				artifacts: effectiveTrace?.artifacts ?? {},
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	if (trace) {
		await writeFile(
			transcriptPath,
			formatTranscriptMarkdown({
				scenario,
				trace,
				failures: result.failures,
				judgeVerdicts: result.judgeVerdicts,
				result,
			}),
			"utf8",
		);
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
			usage: trace.usage,
			judgeVerdicts: trace.judgeVerdicts,
		};
		await writeFile(join(dir, "trace.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	} else {
		// Parent rewrite after a failed staging load must not clobber a richer child bundle.
		let transcriptExists = false;
		try {
			await access(transcriptPath);
			transcriptExists = true;
		} catch {
			transcriptExists = false;
		}
		if (!transcriptExists) {
			await writeFile(
				transcriptPath,
				formatTranscriptMarkdown({
					scenario,
					trace,
					failures: result.failures,
					judgeVerdicts: result.judgeVerdicts,
					result,
				}),
				"utf8",
			);
		}
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
		`# Re-run failed scenario ${shellCommentText(scenario.name)}`,
		`# Requires CURSOR_API_KEY in the environment for --live.`,
		`cd ${shellQuote(rerun.cwd)}`,
		buildRerunCommand(rerun),
		"",
	].join("\n");
	await writeFile(rerunPath, rerunBody, "utf8");
	await chmod(rerunPath, 0o755);

	return dir;
}
