import { describe, it } from "bun:test";
import type { AgentTrace } from "@post-print/agent-harness";
import { expect } from "../sdk/expect.js";
import { ConditionsUnknownError, type RunExposure, runExposure } from "../sdk/run-record.js";
import type { Run } from "../sdk/types.js";

const BUN_TEST = /\bbun test\b/;

describe("skill use", () => {
	it("accepts a skill loaded by the host's tool or read from its file, and nothing else", () => {
		const skills = [{ source: "s", destination: ".claude/skills/release-note" }];
		const withSkills = (call: Run["toolCalls"][number]) => ({
			...recordedRun(call),
			startingContext: { instructions: [], files: [], skills, includeGlobalSkills: false },
		});
		const tool = { name: "Skill", args: { skill: "release-note" }, succeeded: true };
		expect(withSkills(tool)).toHaveUsedSkill("release-note");
		const read = {
			name: "Read",
			args: { file_path: ".claude/skills/release-note/SKILL.md" },
			result: "x",
			succeeded: true,
		};
		expect(withSkills(read)).toHaveUsedSkill("release-note");
		const other = { name: "Read", args: { file_path: "PROJECT.md" }, result: "x", succeeded: true };
		expect(withSkills(other)).not.toHaveUsedSkill("release-note");
		const failed = { ...tool, succeeded: false };
		expect(withSkills(failed)).not.toHaveUsedSkill("release-note");
	});
});

describe("agent test matchers", () => {
	it("preserves Playwright's optional assertion message", () => {
		expect("READY", "The response contains READY.").toContain("READY");
	});

	it("counts a recursive shell search with no path as access", () => {
		const searched = (command: string) =>
			recordedRun({ name: "Shell", args: { command }, result: "", exitCode: 0, succeeded: true });
		expect(searched("grep -r due")).toHaveAccessedPath("records/TASK-101.md");
		expect(searched("rg due")).toHaveAccessedPath("records/TASK-101.md");
		expect(searched("grep due PROJECT.md")).not.toHaveAccessedPath("records/TASK-101.md");
		expect(searched("rg due src")).not.toHaveAccessedPath("records/TASK-101.md");
	});

	it("checks a tool call's arguments and outcome when asked", () => {
		const run = recordedRun({ name: "get_task", args: { id: "104", limit: 1 }, succeeded: false });
		expect(run).toHaveCalledTool("get_task");
		expect(run).toHaveCalledTool("get_task", { args: { id: "104" } });
		expect(run).not.toHaveCalledTool("get_task", { args: { id: "TASK-104" } });
		expect(run).not.toHaveCalledTool("get_task", { succeeded: true });
		const unknown = recordedRun({ name: "get_task" });
		expect(() => expect(unknown).toHaveCalledTool("get_task", { succeeded: true })).toThrow(
			"unavailable",
		);
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

const withExposure = (exposure: RunExposure): Run => ({
	...recordedRun({ name: "Read", args: { path: "x" } }),
	exposure,
});
const refuses = (exposure: RunExposure, tool: string) => {
	const run = withExposure(exposure);
	expect(() => expect(run).toHaveBeenOffered(tool)).toThrow(ConditionsUnknownError);
	expect(() => expect(run).not.toHaveBeenOffered(tool)).toThrow(ConditionsUnknownError);
};
const tasksListed = {
	server: "tasks",
	status: "listed" as const,
	tools: [{ name: "get_task" }],
};

describe("offered tools with no complete catalog", () => {
	it("refuses in both directions when one server of several could not list", () => {
		const partial = runExposure(undefined, [
			tasksListed,
			{ server: "notes", status: "failed", error: "boom" },
		]);
		expect(withExposure(partial)).toHaveBeenOffered("get_task");
		refuses(partial, "search_notes");
	});

	it("refuses when the host says a server has not finished connecting or failed", () => {
		for (const status of ["pending", "failed", "needs-auth", undefined]) {
			const report = { tools: ["Bash"], mcpServers: [{ name: "tasks", status }] };
			refuses(runExposure(report, [tasksListed]), "mcp__tasks__get_task");
			expect(withExposure(runExposure(report, [tasksListed]))).toHaveBeenOffered("Bash");
		}
	});

	it("does not claim a built-in either way from an MCP query", () => {
		const queried = runExposure(undefined, [tasksListed]);
		refuses(queried, "Shell");
		refuses(queried, "web_search");
		refuses(queried, "mcp__other__get_task");
	});
});

describe("offered tools with a complete catalog", () => {
	it("answers for a tool of a server that listed everything", () => {
		const run = withExposure(runExposure(undefined, [tasksListed]));
		expect(run).toHaveBeenOffered("get_task");
		expect(run).toHaveBeenOffered("mcp__tasks__get_task");
		expect(run).not.toHaveBeenOffered("mcp__tasks__delete_task");
		expect(run.exposure.tools).toEqual([
			{ name: "get_task", server: "tasks", description: undefined },
		]);
	});

	it("trusts a complete host list in both directions", () => {
		const report = {
			tools: ["Bash", "mcp__tasks__get_task"],
			mcpServers: [{ name: "tasks", status: "connected" }],
		};
		const run = withExposure(runExposure(report, []));
		expect(run).toHaveBeenOffered("Bash");
		expect(run).toHaveBeenOffered("get_task");
		expect(run).not.toHaveBeenOffered("web_search");
	});
});

const TARGET = "records/TASK-101.md";
const shellRun = (command: string) => recordedRun(shell(command, 0));

describe("possible path access through a recursive search", () => {
	it("counts a recursive search with no path, whatever flags it carries", () => {
		for (const command of [
			"grep -r -A 2 due",
			"grep -rA 2 due",
			"grep -r --include '*.md' due",
			"grep -r --include='*.md' due",
			"grep -r -e due",
			"grep -r --regexp=due",
			"egrep -r due",
			"fgrep -R due",
			"grep --dereference-recursive due",
			"grep -rn --max-count 3 due",
			"grep -r 'two words'",
			"rg -g '*.ts' due",
			"rg -g '*.md' due",
			"rg --glob='*.md' due",
			"rg -C 2 due",
			"rg -t md due",
			"rg --type md -n due",
			"rg -e due -e other",
			"rg 'two words'",
			"rg --files",
			"LC_ALL=C grep -r due",
			'/bin/zsh -lc "grep -r -A 2 \\"due date\\""',
		])
			expect(shellRun(command), command).toHaveAccessedPath(TARGET);
	});
});

describe("possible path access within a scoped search", () => {
	it("still sees the search path after a flag's value", () => {
		for (const command of [
			"grep -r -A 2 due src",
			"grep -r --include '*.md' due src",
			"grep -r -e due src",
			"rg -g '*.ts' due src",
			"rg -C 2 due src",
			"rg -e due src",
			"rg --files src",
			"rg 'two words' src",
			"ls | rg due",
		])
			expect(shellRun(command), command).not.toHaveAccessedPath(TARGET);
		expect(shellRun("grep -r -A 2 due records")).toHaveAccessedPath(TARGET);
		expect(shellRun("rg -g '*.md' due records")).toHaveAccessedPath(TARGET);
	});
});

describe("possible path access through tokens and arguments", () => {
	it("never throws on a token that is not a valid pattern", () => {
		for (const command of [
			"if [ -f README.md ]; then echo ok; fi",
			"echo [",
			"grep 'foo[' PROJECT.md",
			"echo [z-a]",
			"echo ']' '(' '+' '\\'",
		]) {
			expect(shellRun(command), command).not.toHaveAccessedPath(TARGET);
			expect(() => expect(shellRun(command)).toHaveAccessedPath(TARGET)).toThrow("possible access");
		}
		const grep = { name: "Grep", args: { pattern: "foo[", path: "src" } };
		expect(recordedRun(grep)).not.toHaveAccessedPath(TARGET);
	});

	it("reads globs the way a shell or Glob tool does", () => {
		for (const glob of [
			"records/TASK-10[1-4].md",
			"records/TASK-10[!2].md",
			"records/{TASK-101,TASK-104}.md",
			"records/**/TASK-101.md",
			"**/*.md",
			"records/TASK-10?.md",
		]) {
			expect(shellRun(`cat ${glob}`), glob).toHaveAccessedPath(TARGET);
			const tool = { name: "Glob", args: { pattern: glob, path: "." } };
			expect(recordedRun(tool), glob).toHaveAccessedPath(TARGET);
		}
		expect(shellRun("cat records/TASK-10[!1].md")).not.toHaveAccessedPath(TARGET);
		expect(shellRun("cat records/{TASK-102,TASK-104}.md")).not.toHaveAccessedPath(TARGET);
		expect(shellRun("cat app/[id]/page.tsx")).toHaveAccessedPath("app/[id]/page.tsx");
	});
});

describe("possible path access through tool arguments", () => {
	it("sees a path in any argument of a file tool", () => {
		for (const args of [
			{ notebook_path: TARGET },
			{ directory_path: "records" },
			{ paths: ["src/a.ts", TARGET] },
		])
			expect(recordedRun({ name: "list_things", args })).toHaveAccessedPath(TARGET);
		expect(recordedRun({ name: "Shell", args: { command: ["cat", TARGET] } })).toHaveAccessedPath(
			TARGET,
		);
	});

	it("does not take a shell call's working directory for access", () => {
		const call = { name: "Shell", args: { command: "echo hi", cwd: "/tmp/workspace" } };
		expect(recordedRun(call)).not.toHaveAccessedPath(TARGET);
	});

	it("refuses when a call that could read files recorded no arguments", () => {
		for (const call of [{ name: "Shell" }, { name: "Read" }, { name: "Bash", args: {} }]) {
			const unrecorded = recordedRun(call);
			expect(() => expect(unrecorded).not.toHaveAccessedPath(TARGET)).toThrow(
				ConditionsUnknownError,
			);
			expect(() => expect(unrecorded).toHaveAccessedPath(TARGET)).toThrow(ConditionsUnknownError);
		}
		expect(recordedRun({ name: "web_search" })).not.toHaveAccessedPath(TARGET);
	});
});

const unobservable = (capabilities: Partial<Run["capabilities"]>): Run => ({
	...recordedRun(shell("bun test", 0)),
	capabilities: { conversation: "native", ...capabilities },
});

describe("missing evidence is no verdict", () => {
	it("reports missing evidence as no verdict rather than an agent failure", () => {
		const blind = unobservable({});
		for (const ask of [
			() => expect(blind).toHaveCalledTool("x"),
			() => expect(blind).not.toHaveCalledTool("x"),
			() => expect(blind).toHaveCalledToolsInOrder(["x"]),
			() => expect(blind).not.toHaveAccessedPath("x"),
			() => expect(blind).toHaveExecutedCommand({ command: "x" }),
			() => expect(blind).toHaveUsedSkill("x"),
			() => expect(blind).toHaveReadPath("x"),
		])
			expect(ask).toThrow(ConditionsUnknownError);
		const noExit = unobservable({ toolCalls: true });
		expect(() => expect(noExit).toHaveExecutedCommand({ command: "x", exitCode: 0 })).toThrow(
			ConditionsUnknownError,
		);
		const notShown = recordedRun({ name: "Shell", args: { command: "bun test" } });
		expect(() =>
			expect(notShown).toHaveExecutedCommand({ command: "bun test", exitCode: 0 }),
		).toThrow(ConditionsUnknownError);
		expect(() => expect(notShown).toHaveCalledTool("Shell", { succeeded: true })).toThrow(
			ConditionsUnknownError,
		);
		const unread = recordedRun({ name: "Read", args: { path: "PROJECT.md" } });
		expect(() => expect(unread).not.toHaveReadPath("PROJECT.md")).toThrow(ConditionsUnknownError);
	});
});

describe("command and tool call evidence", () => {
	it("does not read a pipeline's exit code as absence of a failing command", () => {
		const piped = recordedRun(shell("bun test | tail -5", 0));
		expect(() =>
			expect(piped).not.toHaveExecutedCommand({ command: BUN_TEST, exitCode: 1 }),
		).toThrow(ConditionsUnknownError);
		expect(() => expect(piped).toHaveExecutedCommand({ command: BUN_TEST, exitCode: 0 })).toThrow(
			ConditionsUnknownError,
		);
		expect(piped).not.toHaveExecutedCommand({ command: "npm test", exitCode: 1 });
	});

	it("compares tool arguments by value and refuses arguments it never saw", () => {
		const nested = recordedRun({ name: "t", args: { filter: { a: 1, b: 2 } } });
		expect(nested).toHaveCalledTool("t", { args: { filter: { b: 2, a: 1 } } });
		expect(nested).not.toHaveCalledTool("t", { args: { filter: { a: 1 } } });
		const unseen = recordedRun({ name: "t" });
		expect(() => expect(unseen).not.toHaveCalledTool("t", { args: { id: 1 } })).toThrow(
			ConditionsUnknownError,
		);
		expect(unseen).toHaveCalledTool("t");
	});

	it("does not let a call with no outcome hide one that succeeded", () => {
		const run = recordedRun({ name: "t", succeeded: true });
		const calls = [...run.toolCalls, { name: "t" }];
		const both = { ...run, toolCalls: calls };
		expect(both).toHaveCalledTool("t", { succeeded: true });
		expect(() => expect(both).toHaveCalledTool("t", { succeeded: false })).toThrow(
			ConditionsUnknownError,
		);
	});

	it("does not take writing a path for reading it", () => {
		const written = recordedRun(shell("cat notes.md > PROJECT.md", 0));
		expect(written).not.toHaveReadPath("PROJECT.md");
		expect(written).toHaveReadPath("notes.md");
		expect(recordedRun(shell("cat notes.md >> PROJECT.md", 0))).not.toHaveReadPath("PROJECT.md");
	});
});

describe("modified path evidence", () => {
	it("names a modified path however the test spells it, and folders by their contents", () => {
		const changed: Run = {
			...recordedRun(shell("true", 0)),
			workspace: {
				root: "/tmp/workspace",
				initial: { path: "/tmp/initial", files: {} },
				final: { path: "/tmp/final", files: {} },
				changedPaths: ["src/a.ts"],
			},
		};
		expect(changed).toHaveModifiedPath("src/a.ts");
		expect(changed).toHaveModifiedPath("./src/a.ts");
		expect(changed).toHaveModifiedPath("/tmp/workspace/src/a.ts");
		expect(changed).toHaveModifiedPath("src");
		expect(changed).not.toHaveModifiedPath("src/b.ts");
		expect(changed).not.toHaveModifiedPath("src/a.ts.bak");
	});

	it("refuses a modification question about a path snapshots leave out", () => {
		const run = recordedRun(shell("true", 0));
		for (const path of ["node_modules/pkg/index.js", ".git/config", "./.venv/x"]) {
			expect(() => expect(run).toHaveModifiedPath(path)).toThrow(ConditionsUnknownError);
			expect(() => expect(run).not.toHaveModifiedPath(path)).toThrow(ConditionsUnknownError);
		}
	});
});

describe("skill evidence", () => {
	const attached = (call: Run["toolCalls"][number]): Run => ({
		...recordedRun(call),
		startingContext: {
			instructions: [],
			files: [],
			skills: [{ source: "s", destination: ".claude/skills/release-note" }],
			includeGlobalSkills: false,
		},
	});
	const SKILL_FILE = ".claude/skills/release-note/SKILL.md";

	it("does not count writing the skill file as using it", () => {
		const write = { name: "Write", args: { file_path: SKILL_FILE }, succeeded: true };
		expect(attached(write)).not.toHaveUsedSkill("release-note");
	});

	it("counts reading a skill that was not attached, such as a global one", () => {
		const global = {
			name: "Read",
			args: { file_path: "/home/u/.claude/skills/release-note/SKILL.md" },
			result: "x",
			succeeded: true,
		};
		expect(recordedRun(global)).toHaveUsedSkill("release-note");
		expect(recordedRun(shell("cat ~/.claude/skills/release-note/SKILL.md", 0))).toHaveUsedSkill(
			"release-note",
		);
		expect(recordedRun(global)).not.toHaveUsedSkill("note");
	});

	it("refuses when the read of the skill file has no recorded outcome", () => {
		const unknown = attached({ name: "Read", args: { file_path: SKILL_FILE } });
		expect(() => expect(unknown).not.toHaveUsedSkill("release-note")).toThrow(
			ConditionsUnknownError,
		);
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

describe("tools with no recorded arguments", () => {
	it("a tool whose name only contains the letters of read is not a read", () => {
		const listing = recordedRun({ name: "mcp__records__list_threads" });
		expect(listing).not.toHaveAccessedPath("records/TASK-101.md");
	});
});
