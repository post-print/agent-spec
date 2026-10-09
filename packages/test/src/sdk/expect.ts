import { basename, relative, resolve, sep } from "node:path";
import { expect as base } from "@playwright/test";
import { type ShellSegment, shellSegments } from "@post-print/agent-harness";
import { consumeCriterionOperations } from "./criterion-provenance.js";
import type { Run } from "./types.js";

const FILE_PROTOCOL = /^file:\/\//;
const COMMAND_TOOL = /shell|bash|terminal|exec|command/i;
const READ_TOOL = /read/i;
const SEARCH_TOOL = /^(grep|glob)$/i;
const GLOB_CHARS = /[*?[]/;
const PATH_ARG_KEYS = ["path", "file_path", "filePath", "target_file", "uri", "pattern"];
const FILE_READING_COMMANDS = new Set([
	"awk",
	"bat",
	"cat",
	"cut",
	"grep",
	"head",
	"less",
	"more",
	"nl",
	"rg",
	"sed",
	"tail",
	"xxd",
]);
type ToolCall = Run["toolCalls"][number];

const matches = (actual: string, expected: string | RegExp) =>
	typeof expected === "string"
		? actual === expected
		: new RegExp(expected.source, expected.flags.replace("g", "").replace("y", "")).test(actual);
function workspacePath(run: Run, value: string): string {
	return resolve(run.workspace.root, value.replace(FILE_PROTOCOL, ""));
}
function samePath(run: Run, actual: string, expected: string) {
	return workspacePath(run, actual) === workspacePath(run, expected);
}
/** True when `actual` names `expected` itself or a directory that contains it. */
function coversPath(run: Run, actual: string, expected: string): boolean {
	const rel = relative(workspacePath(run, actual), workspacePath(run, expected));
	return rel === "" || !(rel === ".." || rel.startsWith(`..${sep}`) || resolve(rel) === rel);
}
function globRegExp(glob: string): RegExp {
	const source = glob
		.split("**")
		.map((part) =>
			part
				.replace(/[.+^${}()|\\]/g, "\\$&")
				.replaceAll("*", "[^/]*")
				.replaceAll("?", "[^/]"),
		)
		.join(".*");
	return new RegExp(`^${source}$`);
}
function globMatches(run: Run, glob: string, expected: string): boolean {
	return globRegExp(workspacePath(run, glob)).test(workspacePath(run, expected));
}
/** A token that may expose `expected`: the path, an enclosing directory, or a matching glob. */
function mayExpose(run: Run, token: string, expected: string): boolean {
	return GLOB_CHARS.test(token)
		? globMatches(run, token, expected)
		: coversPath(run, token, expected);
}
function commandText(call: ToolCall): string {
	return String(call.args?.command ?? call.args?.cmd ?? "");
}
function requireTools(run: Run) {
	if (!run.capabilities.toolCalls)
		throw new Error("Tool-call observation unavailable for this adapter");
}
function shellReadsPath(run: Run, command: string, path: string): boolean {
	return shellSegments(command).some(({ tokens }) => {
		const executable = tokens[0];
		return Boolean(
			executable &&
				FILE_READING_COMMANDS.has(basename(executable)) &&
				tokens.slice(1).some((token) => samePath(run, token, path)),
		);
	});
}
/**
 * The shell exit code belongs to a segment only when it runs last and every earlier
 * segment is joined by `&&` or `;`. Pipes and `||` hide or replace its status.
 */
function ownsExitCode(segments: ShellSegment[], index: number): boolean {
	if (index !== segments.length - 1) return false;
	return segments.slice(0, index).every(({ next }) => next === "&&" || next === ";");
}
function segmentText(segment: ShellSegment): string {
	return segment.tokens.join(" ");
}
interface CommandMatch {
	call: ToolCall;
	ownsExitCode: boolean;
}
function commandMatches(call: ToolCall, expected: string | RegExp): CommandMatch | undefined {
	const raw = commandText(call);
	const segments = shellSegments(raw);
	const index = segments.findIndex((segment) => matches(segmentText(segment), expected));
	if (index >= 0) return { call, ownsExitCode: ownsExitCode(segments, index) };
	return matches(raw, expected) ? { call, ownsExitCode: segments.length <= 1 } : undefined;
}
function accessesPath(run: Run, call: ToolCall, path: string): boolean {
	const args = call.args ?? {};
	const named = PATH_ARG_KEYS.map((key) => args[key]).filter(
		(value): value is string => typeof value === "string",
	);
	if (SEARCH_TOOL.test(call.name) && !args.path) return true;
	if (named.some((value) => mayExpose(run, value, path))) return true;
	if (!COMMAND_TOOL.test(call.name)) return false;
	return shellSegments(commandText(call)).some(({ tokens }) =>
		tokens.slice(1).some((token) => !token.startsWith("-") && mayExpose(run, token, path)),
	);
}
const outcome = (pass: boolean, description: string) => ({ pass, message: () => description });
interface ExpectedCommand {
	command: string | RegExp;
	exitCode?: number;
}
function executedCommandMessage(
	expected: ExpectedCommand,
	calls: ToolCall[],
	unattributed: number,
): string {
	const exit = expected.exitCode === undefined ? "" : ` with exit code ${expected.exitCode}`;
	const note = unattributed
		? `\n${unattributed} matching command(s) ran in a pipeline, after ||, or before another command, so the recorded exit code is not theirs.`
		: "";
	return `Expected command ${String(expected.command)}${exit}${note}\nObserved: ${JSON.stringify(calls)}`;
}
const extendedExpect = base.extend({
	toHaveExecutedCommand(run: Run, expected: ExpectedCommand) {
		requireTools(run);
		const wantsExit = expected.exitCode !== undefined;
		if (wantsExit && !run.capabilities.commandExitCodes)
			throw new Error("Command exit-code evidence unavailable for this adapter");
		const calls = run.toolCalls.filter((call) => COMMAND_TOOL.test(call.name));
		const matching = calls
			.map((call) => commandMatches(call, expected.command))
			.filter((match): match is CommandMatch => match !== undefined);
		const attributable = wantsExit ? matching.filter((match) => match.ownsExitCode) : matching;
		const found = attributable.some(
			(match) => !wantsExit || match.call.exitCode === expected.exitCode,
		);
		if (!found && wantsExit && attributable.some((match) => match.call.exitCode === undefined))
			throw new Error("Command exit-code evidence unavailable");
		return outcome(
			found,
			executedCommandMessage(expected, calls, matching.length - attributable.length),
		);
	},
	toHaveCalledTool(run: Run, expected: string | RegExp) {
		requireTools(run);
		return outcome(
			run.toolCalls.some((call) => matches(call.name, expected)),
			`Expected tool ${String(expected)}; observed ${run.toolCalls.map((call) => call.name).join(", ")}`,
		);
	},
	toHaveCalledToolsInOrder(run: Run, expected: (string | RegExp)[]) {
		requireTools(run);
		let index = 0;
		for (const call of run.toolCalls)
			if (index < expected.length && matches(call.name, expected[index])) index++;
		return outcome(
			index === expected.length,
			`Expected tool sequence ${expected.map(String).join(" → ")}`,
		);
	},
	toHaveReadPath(run: Run, path: string) {
		if (!run.capabilities.fileReads)
			throw new Error("Successful file-read evidence unavailable for this adapter");
		const readCalls = run.toolCalls.filter(
			(call) =>
				READ_TOOL.test(call.name) &&
				Object.values(call.args ?? {}).some(
					(value) => typeof value === "string" && samePath(run, value, path),
				),
		);
		const shellCalls = run.toolCalls.filter(
			(call) => COMMAND_TOOL.test(call.name) && shellReadsPath(run, commandText(call), path),
		);
		const calls = [...readCalls, ...shellCalls];
		const found = calls.some((call) => call.succeeded === true && call.result !== undefined);
		if (!found && calls.some((call) => call.result === undefined || call.succeeded === undefined))
			throw new Error(`Successful file-read evidence unavailable: ${path}`);
		return outcome(found, `Expected successful read of ${path}`);
	},
	toHaveAccessedPath(run: Run, path: string) {
		requireTools(run);
		return outcome(
			run.toolCalls.some((call) => accessesPath(run, call, path)),
			`Expected possible access to ${path} (exact path, enclosing directory, matching glob, or an unscoped search)`,
		);
	},
	toHaveModifiedPath(run: Run, path: string) {
		return outcome(
			run.workspace.changedPaths.includes(path),
			`Expected resulting modification to ${path}; changed: ${run.workspace.changedPaths.join(", ")}`,
		);
	},
});

function recordCriterionOwners(actual: unknown, criterion: unknown): void {
	const owners = new Set(consumeCriterionOperations());
	if (isOperationResult(actual)) owners.add(actual.id);
	if (
		typeof criterion !== "string" ||
		(!process.env.AGENT_TEST_VIEWER_EVENTS && !process.env.AGENT_TEST_RECORDER)
	)
		return;
	for (const runId of owners)
		process.stdout.write(
			`@@agent-test:${JSON.stringify({
				runId,
				type: "criterion",
				value: { criterion },
			})}\n`,
		);
}

function isOperationResult(value: unknown): value is { id: string } {
	return Boolean(
		value &&
			typeof value === "object" &&
			"id" in value &&
			typeof value.id === "string" &&
			"usage" in value,
	);
}

export const expect = new Proxy(extendedExpect, {
	apply(target, thisArg, argumentsList) {
		recordCriterionOwners(argumentsList[0], argumentsList[1]);
		return Reflect.apply(target, thisArg, argumentsList);
	},
});
