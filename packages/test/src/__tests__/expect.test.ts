import { describe, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";
import { expect } from "../sdk/expect.js";
import type { Run } from "../sdk/types.js";

const BUN_TEST = /\bbun test\b/;

describe("agent test matchers", () => {
	it("preserves Playwright's optional assertion message", () => {
		expect("READY", "The response contains READY.").toContain("READY");
	});

	it("accepts a successful shell cat as file-read evidence", () => {
		const run = recordedRun({
			name: "Shell",
			args: { command: "/bin/zsh -lc 'cat PROJECT.md'" },
			result: "The next task is TASK-104.",
			exitCode: 0,
			succeeded: true,
		});

		expect(run).toHaveReadPath("PROJECT.md");
	});

	it("does not treat arbitrary shell path access as a successful read", () => {
		const run = recordedRun({
			name: "Shell",
			args: { command: "/bin/zsh -lc 'echo PROJECT.md'" },
			result: "PROJECT.md",
			exitCode: 0,
			succeeded: true,
		});

		expect(run).not.toHaveReadPath("PROJECT.md");
	});
});

describe("agent test matcher evidence", () => {
	it("does not attribute a pipeline's exit code to the command before the pipe", () => {
		for (const command of [
			'/bin/zsh -lc "bun test 2>&1 | tail -20"',
			"bun test || true",
			"bun test; echo done",
		]) {
			const run = recordedRun(shell(command, 0));
			expect(() => expect(run).toHaveExecutedCommand({ command: BUN_TEST, exitCode: 0 })).toThrow(
				"exit code is not theirs",
			);
			expect(run).toHaveExecutedCommand({ command: BUN_TEST });
		}
	});

	it("attributes the exit code when the command runs last after cd", () => {
		const run = recordedRun(shell('/bin/zsh -lc "cd src && bun test"', 0));
		expect(run).toHaveExecutedCommand({ command: BUN_TEST, exitCode: 0 });
		expect(run).toHaveExecutedCommand({ command: "bun test", exitCode: 0 });
	});

	it("accepts nl piped to sed as a file read", () => {
		expect(recordedRun(shell("nl -ba src/status.ts | sed -n '1,40p'", 0))).toHaveReadPath(
			"src/status.ts",
		);
	});

	it("treats enclosing directories, globs, and unscoped searches as possible access", () => {
		const possible: AgentTrace["toolCalls"] = [
			shell("cat records/*.md", 0),
			shell("grep -r due records", 0),
			shell("ls records", 0),
			{ name: "Grep", args: { pattern: "due" }, succeeded: true },
			{ name: "Glob", args: { pattern: "records/**" }, succeeded: true },
		];
		for (const call of possible)
			expect(recordedRun(call)).toHaveAccessedPath("records/TASK-101.md");
		const unrelated = recordedRun(shell("cat records/TASK-104.md src/status.ts", 0));
		expect(unrelated).not.toHaveAccessedPath("records/TASK-101.md");
		expect(
			recordedRun({ name: "Grep", args: { pattern: "x", path: "src" } }),
		).not.toHaveAccessedPath("records/TASK-101.md");
	});
});

function shell(command: string, exitCode: number): AgentTrace["toolCalls"][number] {
	return { name: "Shell", args: { command }, result: "", exitCode, succeeded: exitCode === 0 };
}

function recordedRun(toolCall: AgentTrace["toolCalls"][number]): Run {
	const trace: AgentTrace = {
		messages: [],
		toolCalls: [toolCall],
		shellCommands: [String(toolCall.args?.command ?? "")],
		artifacts: {},
	};
	const run: Run = {
		id: "run-1",
		name: "agent",
		prompt: "Read PROJECT.md",
		output: "TASK-104",
		trace,
		conversation: trace,
		toolCalls: trace.toolCalls,
		durationMs: 1,
		usage: { tokens: {} },
		capabilities: {
			conversation: "native",
			toolCalls: true,
			commandExitCodes: true,
			fileReads: true,
		},
		startingContext: {
			instructions: [],
			files: [],
			skills: [],
			includeGlobalSkills: false,
		},
		artifact: "/tmp/run-1",
		workspace: {
			root: "/tmp/workspace",
			initial: { path: "/tmp/initial", files: {} },
			final: { path: "/tmp/final", files: {} },
			changedPaths: [],
		},
		continue: async () => run,
	};
	return run;
}
