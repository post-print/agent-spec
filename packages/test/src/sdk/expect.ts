import { basename, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { expect as base } from "@playwright/test";
import { type ShellSegment, shellPayload, shellSegments } from "@post-print/agent-harness";
import { consumeCriterionOperations } from "./criterion-provenance.js";
import { ConditionsUnknownError, listedTool, offeredTool, type RunExposure } from "./run-record.js";
import { snapshotBudget } from "./snapshot-storage.js";
import type { Run } from "./types.js";

const FILE_PROTOCOL = /^file:\/\//;
const COMMAND_TOOL = /shell|bash|terminal|exec|command/i;
/** read_file, NotebookRead or fileread, but not list_threads, spreadsheet or already. */
const READ_TOOL = /(?<!th|sp|b|d|al)read/i;
const SEARCH_TOOL = /^(grep|glob)$/i;
const SKILL_TOOL = /^skill$/i;
const GLOB_CHARS = /[*?[{]/;
/** Everything in a glob that means something to a shell or to a regular expression. */
const GLOB_SYNTAX = /\*\*\/|\*\*|\[!?[^\]/]+\]|\{[^{}]*,[^{}]*\}|[*?]|[.+^$()|\\[\]{}]/g;
const CLASS_MEMBER_SYNTAX = /[\\\]^]/g;
/** An output target is written, not read: `cat notes.md > PROJECT.md`. */
const OUTPUT_REDIRECT = /\d*>>?\s*[^\s;&|]+/g;
const ENV_ASSIGNMENT = /^\w+=/;
const PATH_SEPARATOR = /[\\/]/;
const WHITESPACE = /\s/g;
/** Quotes hold one argument, but shell tokens split on spaces. */
const QUOTED_WITH_SPACES = /(["'])[^"']*\s[^"']*\1/g;
/** Shell tokens replace `--opt=value` with `value`. Keep the option so it does not read as an operand. */
const ATTACHED_OPTION_VALUE = /(\s--?[\w-]+=)(?:"[^"]*"|'[^']*'|[^\s;&|]*)/g;
/** Server states under which a catalog holds every tool that server has. */
const COMPLETE_SERVER = new Set(["connected", "listed"]);
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
function characterClassSource(atom: string): string {
	const body = atom.slice(1, -1);
	const negated = body.length > 1 && body.startsWith("!");
	const members = (negated ? body.slice(1) : body).replace(CLASS_MEMBER_SYNTAX, "\\$&");
	return `[${negated ? "^" : ""}${members}]`;
}
function globAtomSource(atom: string): string {
	if (atom === "**/") return "(?:.*/)?";
	if (atom === "**") return ".*";
	if (atom === "*") return "[^/]*";
	if (atom === "?") return "[^/]";
	if (atom.length === 1) return `\\${atom}`;
	if (atom.startsWith("[")) return characterClassSource(atom);
	return `(?:${atom.slice(1, -1).split(",").map(globSource).join("|")})`;
}
function globSource(glob: string): string {
	return glob.replace(GLOB_SYNTAX, (atom) => globAtomSource(atom));
}
function globMatches(run: Run, glob: string, expected: string): boolean {
	try {
		return new RegExp(`^${globSource(workspacePath(run, glob))}$`).test(
			workspacePath(run, expected),
		);
	} catch {
		// A range such as `[z-a]` matches nothing in a shell either.
		return false;
	}
}
/** A token that may expose `expected`: the path, an enclosing directory, or a matching glob. */
function mayExpose(run: Run, token: string, expected: string): boolean {
	if (coversPath(run, token, expected)) return true;
	return GLOB_CHARS.test(token) && globMatches(run, token, expected);
}
function commandText(call: ToolCall): string {
	const command = call.args?.command ?? call.args?.cmd ?? "";
	return Array.isArray(command) ? command.join(" ") : String(command);
}
function requireTools(run: Run) {
	if (!run.capabilities.toolCalls)
		throw new ConditionsUnknownError("Tool-call observation unavailable for this adapter");
}
/** Drop leading `NAME=value` assignments, so `tokens[0]` is the program that runs. */
function withoutEnvAssignments(tokens: string[]): string[] {
	const start = tokens.findIndex((token) => !ENV_ASSIGNMENT.test(token));
	return start < 0 ? [] : tokens.slice(start);
}
function shellReadTokens(command: string): string[] {
	return shellSegments(shellPayload(command).replace(OUTPUT_REDIRECT, "")).flatMap(({ tokens }) => {
		const [executable, ...operands] = withoutEnvAssignments(tokens);
		return executable && FILE_READING_COMMANDS.has(basename(executable)) ? operands : [];
	});
}
function shellReadsPath(run: Run, command: string, path: string): boolean {
	return shellReadTokens(command).some((token) => samePath(run, token, path));
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
const RECURSIVE_FLAG = /^-[a-zA-Z0-9]*[rR]|^--recursive$|^--dereference-recursive$/;
/** Options that need no pattern operand: every operand is then a path to search. */
const PATTERN_OPTION = /^(--regexp=?|--file=?|--files|--type-list)$/;
/** Options of a recursive search that take a value, so the next token is not an operand. */
interface SearchOptions {
	shortWithValue: string;
	longWithValue: Set<string>;
}
const GREP_OPTIONS: SearchOptions = {
	shortWithValue: "ABCDdefm",
	longWithValue: new Set([
		"--after-context",
		"--before-context",
		"--binary-files",
		"--context",
		"--devices",
		"--directories",
		"--exclude",
		"--exclude-dir",
		"--exclude-from",
		"--file",
		"--group-separator",
		"--include",
		"--label",
		"--max-count",
		"--regexp",
	]),
};
const RG_OPTIONS: SearchOptions = {
	shortWithValue: "ABCEMTefgjmrt",
	longWithValue: new Set([
		"--after-context",
		"--before-context",
		"--color",
		"--colors",
		"--context",
		"--encoding",
		"--engine",
		"--file",
		"--glob",
		"--iglob",
		"--ignore-file",
		"--max-columns",
		"--max-count",
		"--max-depth",
		"--max-filesize",
		"--pre",
		"--pre-glob",
		"--regexp",
		"--replace",
		"--sort",
		"--sortr",
		"--threads",
		"--type",
		"--type-add",
		"--type-clear",
		"--type-not",
	]),
};
const SEARCH_OPTIONS = new Map([
	["egrep", GREP_OPTIONS],
	["fgrep", GREP_OPTIONS],
	["grep", GREP_OPTIONS],
	["rg", RG_OPTIONS],
]);
/** The first short option in a cluster that takes a value, as in `-rA 2` or `-A2`. */
function valueOptionAt(option: string, { shortWithValue }: SearchOptions): number {
	return [...option].findIndex((letter, index) => index > 0 && shortWithValue.includes(letter));
}
function takesNextToken(option: string, options: SearchOptions): boolean {
	if (option.startsWith("--")) return options.longWithValue.has(option);
	const at = valueOptionAt(option, options);
	return at > 0 && at === option.length - 1;
}
function suppliesPattern(option: string, options: SearchOptions): boolean {
	if (option.startsWith("--")) return PATTERN_OPTION.test(option);
	const at = valueOptionAt(option, options);
	return at > 0 && "ef".includes(option.charAt(at));
}
interface SearchOperands {
	operands: string[];
	patternFromOption: boolean;
}
function searchOperands(args: string[], options: SearchOptions): SearchOperands {
	const operands: string[] = [];
	let patternFromOption = false;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "--") {
			operands.push(...args.slice(index + 1));
			break;
		}
		if (!arg.startsWith("-")) {
			operands.push(arg);
			continue;
		}
		patternFromOption ||= suppliesPattern(arg, options);
		if (takesNextToken(arg, options)) index++;
	}
	return { operands, patternFromOption };
}
/**
 * `grep -r x` and `rg x` read everything under the working directory. Piped into, `rg` reads the
 * pipe instead. Options outside the tables above read as operands, a limit of not parsing shell.
 */
function isUnscopedShellSearch(segment: ShellSegment, pipedInto: boolean): boolean {
	const [executable = "", ...args] = withoutEnvAssignments(segment.tokens);
	const program = basename(executable);
	const options = SEARCH_OPTIONS.get(program);
	if (!options) return false;
	const recursive = program === "rg" ? !pipedInto : args.some((arg) => RECURSIVE_FLAG.test(arg));
	const { operands, patternFromOption } = searchOperands(args, options);
	return recursive && operands.length <= (patternFromOption ? 0 : 1);
}
/** Segments for counting a search's operands: each quoted or attached value stays one token. */
function searchSegments(command: string): ShellSegment[] {
	const payload = shellPayload(command)
		.replace(QUOTED_WITH_SPACES, (quoted) => quoted.replace(WHITESPACE, "_"))
		.replace(ATTACHED_OPTION_VALUE, "$1");
	return shellSegments(payload);
}
function shellAccessesPath(run: Run, command: string, path: string): boolean {
	const searches = searchSegments(command);
	if (searches.some((segment, i) => isUnscopedShellSearch(segment, searches[i - 1]?.next === "|")))
		return true;
	return shellSegments(command).some(({ tokens }) =>
		tokens.slice(1).some((token) => !token.startsWith("-") && mayExpose(run, token, path)),
	);
}
function stringArguments(args: Record<string, unknown>): string[] {
	return Object.values(args)
		.flat()
		.filter((value): value is string => typeof value === "string");
}
function accessesPath(run: Run, call: ToolCall, path: string): boolean {
	const args = call.args ?? {};
	if (SEARCH_TOOL.test(call.name) && !args.path) return true;
	const command = commandText(call);
	if (COMMAND_TOOL.test(call.name) && command) return shellAccessesPath(run, command, path);
	return stringArguments(args).some((value) => mayExpose(run, value, path));
}
/** A call that could read files, with no record of what it was asked to read. */
function accessIsUnrecorded(call: ToolCall): boolean {
	const couldReadFiles = COMMAND_TOOL.test(call.name) || READ_TOOL.test(call.name);
	return couldReadFiles && Object.keys(call.args ?? {}).length === 0;
}
/** `mcp__server__tool` for a server that listed everything: an absent tool is a real "no". */
function namesListedServer(exposure: RunExposure, tool: string): boolean {
	return exposure.mcpServers.some(({ name }) => tool.startsWith(`mcp__${name}__`));
}
/** Why this catalog cannot answer for this tool, or undefined when it can. */
function catalogGap(exposure: RunExposure, tool: string): string | undefined {
	if (exposure.source === "unknown") return "this run recorded no complete tool catalog";
	const unavailable = exposure.mcpServers.filter(({ status }) => !COMPLETE_SERVER.has(status));
	if (unavailable.length)
		return `MCP server ${unavailable.map(({ name, status }) => `${name} is ${status}`).join(", ")}`;
	const answerable =
		exposure.source === "host" || offeredTool(exposure, tool) || namesListedServer(exposure, tool);
	if (answerable) return undefined;
	return `the catalog comes from asking MCP servers, so built-in tools are not known. To ask about an MCP tool, name it mcp__<server>__${tool}`;
}
function hasBeenOffered(exposure: RunExposure, tool: string): boolean {
	// A tool on the list was offered, whatever else is missing. Only "not offered" needs the whole list.
	if (listedTool(exposure, tool)) return true;
	const gap = catalogGap(exposure, tool);
	if (gap)
		throw new ConditionsUnknownError(`Cannot tell whether the agent was offered ${tool}: ${gap}.`);
	return offeredTool(exposure, tool);
}
function offeredList({ source, tools }: RunExposure): string {
	const names = tools.map(({ name, server }) => (server ? `${server}/${name}` : name));
	return `offered (${source}): ${names.join(", ")}`;
}
function requireSnapshotted(path: string): void {
	const excluded = snapshotBudget().excludedNames;
	if (path.split(PATH_SEPARATOR).some((part) => excluded.has(part)))
		throw new ConditionsUnknownError(
			`Cannot tell whether ${path} was modified: workspace snapshots leave it out.`,
		);
}
const outcome = (pass: boolean, description: string) => ({ pass, message: () => description });
interface ExpectedCommand {
	command: string | RegExp;
	exitCode?: number;
}
function executedCommandMessage(expected: ExpectedCommand, calls: ToolCall[]): string {
	const exit = expected.exitCode === undefined ? "" : ` with exit code ${expected.exitCode}`;
	return `Expected command ${String(expected.command)}${exit}\nObserved: ${JSON.stringify(calls)}`;
}
/** A matching command whose exit code the trace cannot show leaves the answer open. */
function exitEvidenceGap(matching: CommandMatch[]): string | undefined {
	const hidden = matching.filter((match) => !match.ownsExitCode).length;
	if (hidden)
		return `${hidden} matching command(s) ran in a pipeline, after ||, or before another command, so the recorded exit code is not theirs.`;
	if (matching.some((match) => match.call.exitCode === undefined))
		return "Command exit-code evidence unavailable";
	return undefined;
}
interface ExpectedToolCall {
	/** Each named argument must equal this value. Other arguments are ignored. */
	args?: Record<string, unknown>;
	succeeded?: boolean;
}
function matchesToolCall(call: ToolCall, { args, succeeded }: ExpectedToolCall): boolean {
	if (succeeded !== undefined && call.succeeded !== succeeded) return false;
	return Object.entries(args ?? {}).every(([key, value]) =>
		isDeepStrictEqual(call.args?.[key], value),
	);
}
function toolCallEvidenceGap(calls: ToolCall[], { args, succeeded }: ExpectedToolCall) {
	if (succeeded !== undefined && calls.some((call) => call.succeeded === undefined))
		return "Tool success evidence unavailable";
	if (args && calls.some((call) => call.args === undefined))
		return "Tool argument evidence unavailable";
	return undefined;
}
function skillFileNamed(value: string, name: string): boolean {
	return value.replaceAll("\\", "/").endsWith(`/skills/${name}/SKILL.md`);
}
function readsSkillFile(call: ToolCall, name: string): boolean {
	if (READ_TOOL.test(call.name))
		return stringArguments(call.args ?? {}).some((value) => skillFileNamed(value, name));
	if (!COMMAND_TOOL.test(call.name)) return false;
	return shellReadTokens(commandText(call)).some((token) => skillFileNamed(token, name));
}
const extendedExpect = base.extend({
	toHaveExecutedCommand(run: Run, expected: ExpectedCommand) {
		requireTools(run);
		const wantsExit = expected.exitCode !== undefined;
		if (wantsExit && !run.capabilities.commandExitCodes)
			throw new ConditionsUnknownError("Command exit-code evidence unavailable for this adapter");
		const calls = run.toolCalls.filter((call) => COMMAND_TOOL.test(call.name));
		const matching = calls
			.map((call) => commandMatches(call, expected.command))
			.filter((match): match is CommandMatch => match !== undefined);
		const found = matching.some(
			(match) => !wantsExit || (match.ownsExitCode && match.call.exitCode === expected.exitCode),
		);
		const gap = !found && wantsExit ? exitEvidenceGap(matching) : undefined;
		if (gap) throw new ConditionsUnknownError(gap);
		return outcome(found, executedCommandMessage(expected, calls));
	},
	toHaveCalledTool(run: Run, expected: string | RegExp, details: ExpectedToolCall = {}) {
		requireTools(run);
		const named = run.toolCalls.filter((call) => matches(call.name, expected));
		const found = named.some((call) => matchesToolCall(call, details));
		const gap = found ? undefined : toolCallEvidenceGap(named, details);
		if (gap) throw new ConditionsUnknownError(`${gap} for ${String(expected)}`);
		return outcome(
			found,
			`Expected tool ${String(expected)}${details.args || details.succeeded !== undefined ? ` with ${JSON.stringify(details)}` : ""}; observed ${JSON.stringify(run.toolCalls.map(({ name, args, succeeded }) => ({ name, args, succeeded })))}`,
		);
	},
	toHaveCalledToolsInOrder(run: Run, expected: (string | RegExp)[]) {
		if (expected.length === 0) throw new Error("toHaveCalledToolsInOrder needs at least one tool");
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
			throw new ConditionsUnknownError(
				"Successful file-read evidence unavailable for this adapter",
			);
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
			throw new ConditionsUnknownError(`Successful file-read evidence unavailable: ${path}`);
		return outcome(found, `Expected successful read of ${path}`);
	},
	/** A host may load a skill through its own tool or by reading the file. Either is evidence. */
	toHaveUsedSkill(run: Run, name: string) {
		requireTools(run);
		const loaded = run.toolCalls.some(
			(call) => SKILL_TOOL.test(call.name) && call.args?.skill === name && call.succeeded !== false,
		);
		const reads = run.toolCalls.filter((call) => readsSkillFile(call, name));
		const read = reads.some((call) => call.succeeded === true);
		if (!loaded && !read && reads.some((call) => call.succeeded === undefined))
			throw new ConditionsUnknownError(`Skill read outcome unavailable: ${name}`);
		return outcome(loaded || read, `Expected the agent to use skill ${name}`);
	},
	toHaveAccessedPath(run: Run, path: string) {
		requireTools(run);
		const found = run.toolCalls.some((call) => accessesPath(run, call, path));
		if (!found && run.toolCalls.some(accessIsUnrecorded))
			throw new ConditionsUnknownError(
				`Cannot tell whether ${path} was accessed: a file or shell tool call recorded no arguments.`,
			);
		return outcome(
			found,
			`Expected possible access to ${path} (exact path, enclosing directory, matching glob, or an unscoped search)`,
		);
	},
	toHaveBeenOffered(run: Run, tool: string) {
		return outcome(
			hasBeenOffered(run.exposure, tool),
			`Expected the agent to be offered ${tool}; ${offeredList(run.exposure)}`,
		);
	},
	/** A folder counts as modified when anything inside it changed. */
	toHaveModifiedPath(run: Run, path: string) {
		requireSnapshotted(path);
		return outcome(
			run.workspace.changedPaths.some((changed) => coversPath(run, path, changed)),
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
