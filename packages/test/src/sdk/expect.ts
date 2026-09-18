import { basename, resolve } from "node:path";
import { expect as base } from "@playwright/test";
import { consumeCriterionOperations } from "./criterion-provenance.js";
import type { Run } from "./types.js";

const FILE_PROTOCOL = /^file:\/\//;
const COMMAND_TOOL = /shell|bash|terminal|exec|command/i;
const READ_TOOL = /read/i;
const SHELL_SEPARATORS = /[\s;|&"']+/;
const SHELL_SEGMENTS = /\s*(?:&&|\|\||[;|])\s*/;
const SHELL_WRAPPER = /\s-(?:lc|c)\s+(["'])([\s\S]*)\1\s*$/;
const FILE_READING_COMMANDS = new Set([
	"awk",
	"cat",
	"grep",
	"head",
	"less",
	"more",
	"rg",
	"sed",
	"tail",
]);

const matches = (actual: string, expected: string | RegExp) =>
	typeof expected === "string"
		? actual === expected
		: new RegExp(expected.source, expected.flags.replace("g", "").replace("y", "")).test(actual);
function samePath(run: Run, actual: string, expected: string) {
	return (
		resolve(run.workspace.root, actual.replace(FILE_PROTOCOL, "")) ===
		resolve(run.workspace.root, expected)
	);
}
function requireTools(run: Run) {
	if (!run.capabilities.toolCalls)
		throw new Error("Tool-call observation unavailable for this adapter");
}
function shellReadsPath(run: Run, command: string, path: string): boolean {
	const payload = command.match(SHELL_WRAPPER)?.[2] ?? command;
	return payload.split(SHELL_SEGMENTS).some((segment) => {
		const tokens = segment.trim().split(SHELL_SEPARATORS).filter(Boolean);
		const executable = tokens[0];
		return Boolean(
			executable &&
				FILE_READING_COMMANDS.has(basename(executable)) &&
				tokens.slice(1).some((token) => samePath(run, token, path)),
		);
	});
}
const outcome = (pass: boolean, description: string) => ({ pass, message: () => description });
const extendedExpect = base.extend({
	toHaveExecutedCommand(run: Run, expected: { command: string | RegExp; exitCode?: number }) {
		requireTools(run);
		if (expected.exitCode !== undefined && !run.capabilities.commandExitCodes)
			throw new Error("Command exit-code evidence unavailable for this adapter");
		const calls = run.toolCalls.filter((call) => COMMAND_TOOL.test(call.name));
		const matching = calls.filter((call) =>
			matches(String(call.args?.command ?? call.args?.cmd ?? ""), expected.command),
		);
		const found = matching.some(
			(call) => expected.exitCode === undefined || call.exitCode === expected.exitCode,
		);
		if (
			!found &&
			expected.exitCode !== undefined &&
			matching.some((call) => call.exitCode === undefined)
		)
			throw new Error("Command exit-code evidence unavailable");
		return outcome(
			found,
			`Expected command ${String(expected.command)}${expected.exitCode === undefined ? "" : ` with exit code ${expected.exitCode}`}\nObserved: ${JSON.stringify(calls)}`,
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
		const shellCalls = run.toolCalls.filter((call) => {
			if (!COMMAND_TOOL.test(call.name)) return false;
			const command = String(call.args?.command ?? call.args?.cmd ?? "");
			return shellReadsPath(run, command, path);
		});
		const calls = [...readCalls, ...shellCalls];
		const found = calls.some((call) => call.succeeded === true && call.result !== undefined);
		if (!found && calls.some((call) => call.result === undefined || call.succeeded === undefined))
			throw new Error(`Successful file-read evidence unavailable: ${path}`);
		return outcome(found, `Expected successful read of ${path}`);
	},
	toHaveAccessedPath(run: Run, path: string) {
		requireTools(run);
		return outcome(
			run.toolCalls.some((call) =>
				Object.values(call.args ?? {}).some(
					(value) =>
						typeof value === "string" &&
						(samePath(run, value, path) ||
							(COMMAND_TOOL.test(call.name) &&
								value.split(SHELL_SEPARATORS).some((token) => samePath(run, token, path)))),
				),
			),
			`Expected attempted access to ${path}`,
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
