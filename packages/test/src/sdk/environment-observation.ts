import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { ConditionsUnknownError } from "./run-record.js";

const run = promisify(execFile);
const LARGE_OUTPUT = 32 * 1024 * 1024;
const MANIFEST_ENTRY_LIMIT = 200_000;
const LISTEN_ADDRESS = /:(\d+)$/;
const PROCESS_ROW = /^\s*(\d+)\s+(.*)$/;
/** What can sit next to a path in a command line: `sh /ws/x`, `--config=/ws/x`, `"/ws/x"`. */
const COMMAND_WORD_BOUNDARY = /[\s=:"']+/;

export interface ObserveEnvironment {
	/** Workspace-relative paths to summarize, including ones snapshots exclude such as node_modules. */
	paths?: string[];
}
/** Reading a field of a path that could not be inspected throws `ConditionsUnknownError`. */
export interface PathManifest {
	exists: boolean;
	files: number;
	bytes: number;
	truncated?: boolean;
}
export interface EnvironmentObservation {
	/** False when `ps` or `lsof` could not be run. Reading the two lists below then throws. */
	processesKnown: boolean;
	/** Processes started during the run that are still alive and tied to the workspace. */
	processes: { pid: number; command: string }[];
	/** Ports these processes are listening on. */
	listeningPorts: { port: number; pid: number; command: string }[];
	/** Everything seen to be left behind, for teardown. Not complete when `processesKnown` is false. */
	stoppablePids: number[];
	paths: Record<string, PathManifest>;
}
export interface EnvironmentBaseline {
	/** Undefined when `ps` could not be run, so nothing can be called new later. */
	pids?: Set<number>;
}

interface ProcessEntry {
	pid: number;
	command: string;
}
async function processTable(): Promise<ProcessEntry[] | undefined> {
	try {
		const { stdout } = await run("ps", ["-axo", "pid=,command="], { maxBuffer: LARGE_OUTPUT });
		return stdout.split("\n").flatMap((line) => {
			const match = PROCESS_ROW.exec(line);
			return match ? [{ pid: Number(match[1]), command: match[2] ?? "" }] : [];
		});
	} catch {
		return undefined;
	}
}
export async function captureEnvironmentBaseline(): Promise<EnvironmentBaseline> {
	const table = await processTable();
	return { pids: table && new Set(table.map(({ pid }) => pid)) };
}
/** A failed launch has a string code such as ENOENT. A number is `lsof`'s own "found nothing". */
function couldNotRun(error: unknown): boolean {
	return typeof (error as { code?: unknown }).code === "string";
}
/** Output of `lsof`: empty when it ran and found nothing, undefined when it could not run at all. */
async function lsof(args: string[]): Promise<string | undefined> {
	try {
		return (await run("lsof", args)).stdout;
	} catch (error) {
		return couldNotRun(error) ? undefined : "";
	}
}
function lsofField(output: string, code: string): string[] {
	return output
		.split("\n")
		.filter((line) => line.startsWith(code))
		.map((line) => line.slice(1));
}
function isInside(path: string, directory: string): boolean {
	return path === directory || path.startsWith(`${directory}${sep}`);
}
/** A process counts as the workspace's when its working directory or command is inside it. */
async function ownership(entry: ProcessEntry, workspace: string): Promise<boolean | undefined> {
	if (entry.command.split(COMMAND_WORD_BOUNDARY).some((word) => isInside(word, workspace)))
		return true;
	const output = await lsof(["-a", "-d", "cwd", "-p", String(entry.pid), "-Fn"]);
	return output === undefined
		? undefined
		: lsofField(output, "n").some((path) => isInside(resolve(path), workspace));
}
async function listeningPortsOf({ pid, command }: ProcessEntry) {
	const output = await lsof(["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"]);
	if (output === undefined) return undefined;
	return lsofField(output, "n").flatMap((address) => {
		const port = LISTEN_ADDRESS.exec(address)?.[1];
		return port ? [{ port: Number(port), pid, command }] : [];
	});
}
/** Define fields whose read throws: an absent answer must not look like an empty or false one. */
function withUnknownFields<T extends object>(known: T, fields: string[], reason: string): T {
	for (const field of fields)
		Object.defineProperty(known, field, {
			enumerable: false,
			get() {
				throw new ConditionsUnknownError(`Cannot read ${field}: ${reason}`);
			},
		});
	return known;
}
function isAbsent(error: unknown): boolean {
	const { code } = error as { code?: unknown };
	return code === "ENOENT" || code === "ENOTDIR";
}
async function directoryManifest(path: string): Promise<PathManifest> {
	const items = await readdir(path, { withFileTypes: true, recursive: true });
	const files = items.filter((item) => item.isFile()).slice(0, MANIFEST_ENTRY_LIMIT);
	const sizes = await Promise.all(
		files.map((item) =>
			stat(join(item.parentPath, item.name)).then(
				({ size }) => size,
				() => 0,
			),
		),
	);
	return {
		exists: true,
		files: files.length,
		bytes: sizes.reduce((total, size) => total + size, 0),
		...(items.length > MANIFEST_ENTRY_LIMIT ? { truncated: true } : {}),
	};
}
async function pathManifest(path: string): Promise<PathManifest> {
	try {
		const info = await stat(path);
		if (!info.isDirectory()) return { exists: true, files: 1, bytes: info.size };
		return await directoryManifest(path);
	} catch (error) {
		if (isAbsent(error)) return { exists: false, files: 0, bytes: 0 };
		const fields = ["exists", "files", "bytes"];
		return withUnknownFields(
			{} as PathManifest,
			fields,
			`${path} could not be inspected: ${error}`,
		);
	}
}
interface ProcessEvidence {
	/** Why the lists cannot be trusted, or undefined when they can. */
	gap?: string;
	processes: ProcessEntry[];
	listeningPorts: EnvironmentObservation["listeningPorts"];
}
async function processEvidence(
	baseline: EnvironmentBaseline,
	workspace: string,
): Promise<ProcessEvidence> {
	const table = await processTable();
	const known = baseline.pids;
	if (!table || !known) return { gap: "`ps` could not be run", processes: [], listeningPorts: [] };
	const started = table.filter(({ pid }) => !known.has(pid) && pid !== process.pid);
	const owners = await Promise.all(started.map((entry) => ownership(entry, workspace)));
	const processes = started.filter((_, index) => owners[index]);
	const ports = await Promise.all(processes.map(listeningPortsOf));
	const complete = !owners.includes(undefined) && !ports.includes(undefined);
	return {
		gap: complete ? undefined : "`lsof` could not be run",
		processes,
		listeningPorts: ports.flatMap((entries) => entries ?? []),
	};
}
export async function observeEnvironment(input: {
	baseline: EnvironmentBaseline;
	workspace: string;
	observe: ObserveEnvironment;
}): Promise<EnvironmentObservation> {
	const { baseline, workspace, observe } = input;
	const { gap, processes, listeningPorts } = await processEvidence(baseline, workspace);
	const paths = await Promise.all(
		(observe.paths ?? []).map(
			async (path) => [path, await pathManifest(join(workspace, path))] as const,
		),
	);
	const known = {
		processesKnown: gap === undefined,
		stoppablePids: processes.map(({ pid }) => pid),
		paths: Object.fromEntries(paths),
	};
	if (gap === undefined) return { ...known, processes, listeningPorts };
	const lists = ["processes", "listeningPorts"];
	return withUnknownFields(
		known as EnvironmentObservation,
		lists,
		`${gap}, so absence proves nothing.`,
	);
}
/** A test that observed a survivor has its evidence; the process must not outlive the test. */
export function stopSurvivors(pids: readonly number[]): void {
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Already exited.
		}
	}
}
