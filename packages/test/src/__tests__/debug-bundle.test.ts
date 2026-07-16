import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	buildRerunCommand,
	collectDebugEnvironment,
	getDebugBundleDir,
	shellQuote,
	writeDebugBundle,
} from "../debug-bundle.js";
import { scenarioArtifactSlug } from "../record-trace.js";
import type { AgentScenario, ScenarioResult } from "../types.js";

describe("debug-bundle", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("shell-quotes values with spaces and metacharacters", () => {
		expect(shellQuote("simple")).toBe("simple");
		expect(shellQuote("has space")).toBe("'has space'");
		expect(shellQuote("it's")).toBe("'it'\\''s'");
	});

	it("builds a rerun command with debug flags", () => {
		const cmd = buildRerunCommand({
			cliPath: "/repo/packages/test/dist/cli.js",
			cwd: "/repo",
			suitesDir: "agent-suites",
			suite: "code-review",
			scenario: "pr: anti-thrash targeted contextual",
			live: true,
			debugDir: "/tmp/debug-out",
		});
		expect(cmd).toContain("--live");
		expect(cmd).toContain("--debug");
		expect(cmd).toContain("--debug-dir");
		expect(cmd).toContain("--keep-recordings");
		expect(cmd).toContain("'pr: anti-thrash targeted contextual'");
	});

	it("shell-quotes process.execPath in the rerun command", () => {
		const original = process.execPath;
		Object.defineProperty(process, "execPath", {
			value: "/Users/John Smith/.nvm/versions/node/v22.0.0/bin/node",
			configurable: true,
		});
		try {
			const cmd = buildRerunCommand({
				cliPath: "/repo/cli.js",
				cwd: "/repo",
				suitesDir: "agent-suites",
				suite: "smoke",
				scenario: "hello",
				live: false,
			});
			expect(cmd.startsWith("'/Users/John Smith/.nvm/versions/node/v22.0.0/bin/node' ")).toBe(true);
		} finally {
			Object.defineProperty(process, "execPath", {
				value: original,
				configurable: true,
			});
		}
	});

	it("keeps distinct debug dirs for names that share a slug prefix", () => {
		const root = (sessionId: string) => `/tmp/${sessionId}`;
		const a = getDebugBundleDir("sess", "suite", "Foo Bar", root);
		const b = getDebugBundleDir("sess", "suite", "foo-bar", root);
		expect(a).not.toBe(b);
		expect(a).toContain(scenarioArtifactSlug("Foo Bar"));
		expect(b).toContain(scenarioArtifactSlug("foo-bar"));
		expect(scenarioArtifactSlug("Foo Bar")).not.toBe(scenarioArtifactSlug("foo-bar"));
	});

	it("writes the six debug artifacts and redacts secrets", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-debug-"));
		dirs.push(dir);

		const priorKey = process.env.CURSOR_API_KEY;
		process.env.CURSOR_API_KEY = "super-secret-key";
		process.env.AGENT_TEST_VERBOSE = "1";
		process.env.UNRELATED_SECRET = "should-not-appear";

		try {
			const scenario: AgentScenario = {
				name: "hello world",
				prompt: "Say hi",
				rubric: { must: ["hello"] },
			};
			const result: ScenarioResult = {
				suite: "smoke",
				scenario: scenario.name,
				passed: false,
				durationMs: 12,
				failures: [
					{
						matcher: "mustInclude",
						message: 'expected text not found: "hello"',
						category: "rubric_miss",
						evidence: "nearest: goodbye",
					},
				],
				judgeVerdicts: [
					{
						id: "j1",
						question: "Did it greet?",
						pass: false,
						rationale: "judge run status: failed (sdk: error, error: boom)",
						infraError: "judge run status: failed (sdk: error, error: boom)",
						rawSdkStatus: "error",
						sdkError: { message: "boom", code: "E" },
						attempt: 1,
						durationMs: 5,
						transcriptChars: 10,
						promptChars: 100,
					},
				],
				trace: {
					messages: [{ role: "assistant", content: "goodbye" }],
					toolCalls: [],
					shellCommands: ["echo hi"],
					artifacts: {},
				},
			};

			await writeDebugBundle({
				dir,
				result,
				trace: result.trace,
				scenario,
				environment: collectDebugEnvironment({
					suite: "smoke",
					scenario: scenario.name,
					packageVersion: "0.0.0-test",
					host: "replay",
				}),
				rerun: {
					cliPath: "/cli.js",
					cwd: "/repo",
					suitesDir: "fixtures",
					suite: "smoke",
					scenario: scenario.name,
					live: false,
				},
			});

			const failures = JSON.parse(await readFile(join(dir, "failures.json"), "utf8")) as unknown[];
			expect(failures).toHaveLength(1);

			const env = JSON.parse(await readFile(join(dir, "environment.json"), "utf8")) as {
				cursorApiKeySet: boolean;
				agentTestEnv: Record<string, string>;
			};
			expect(env.cursorApiKeySet).toBe(true);
			expect(JSON.stringify(env)).not.toContain("super-secret-key");
			expect(JSON.stringify(env)).not.toContain("UNRELATED_SECRET");
			expect(env.agentTestEnv.AGENT_TEST_VERBOSE).toBe("1");

			const transcript = await readFile(join(dir, "transcript.md"), "utf8");
			expect(transcript).toContain("## Prompt");
			expect(transcript).toContain("goodbye");
			expect(transcript).toContain("rubric_miss");

			const judge = JSON.parse(await readFile(join(dir, "judge-debug.json"), "utf8")) as Array<{
				infraError?: string;
			}>;
			expect(judge[0]?.infraError).toContain("boom");

			const rerun = await readFile(join(dir, "rerun.sh"), "utf8");
			expect(rerun.startsWith("#!/usr/bin/env bash")).toBe(true);
			expect(rerun).toContain("--debug");
			expect(rerun).toContain("'hello world'");

			const trace = JSON.parse(await readFile(join(dir, "trace.json"), "utf8")) as {
				messages: unknown[];
			};
			expect(trace.messages).toHaveLength(1);
		} finally {
			if (priorKey === undefined) {
				delete process.env.CURSOR_API_KEY;
			} else {
				process.env.CURSOR_API_KEY = priorKey;
			}
			delete process.env.UNRELATED_SECRET;
		}
	});
});
