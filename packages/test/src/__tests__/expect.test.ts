import { describe, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";
import { expect } from "../sdk/expect.js";
import type { Run } from "../sdk/types.js";

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
