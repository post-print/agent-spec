import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const LARGE_OUTPUT = 32 * 1024 * 1024;
const MANIFEST_ENTRY_LIMIT = 200_000;
const LISTEN_ADDRESS = /:(\d+)$/;
const PROCESS_ROW = /^\s*(\d+)\s+(.*)$/;

export interface ObserveEnvironment {
	/** Workspace-relative paths to summarize, including ones snapshots exclude such as node_modules. */
	paths?: string[];
}
export interface PathManifest {
	exists: boolean;
	files: number;
	bytes: number;
	truncated?: boolean;
}
export interface EnvironmentObservation {
	/** False when `ps` or `lsof` could not be run, so absence below proves nothing. */
	processesKnown: boolean;
	/** Processes started during the run that are still alive and tied to the workspace. */
	processes: { pid: number; command: string }[];
	/** Ports these processes are listening on. */
	listeningPorts: { port: number; pid: number; command: string }[];
	paths: Record<string, PathManifest>;
}
export interface EnvironmentBaseline {
	pids: Set<number>;
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
	return { pids: new Set((await processTable())?.map(({ pid }) => pid) ?? []) };
}
function lsofField(output: string, code: string): string[] {
	return output
		.split("\n")
		.filter((line) => line.startsWith(code))
		.map((line) => line.slice(1));
}
/** A process counts as the workspace's when its working directory or command is inside it. */
async function belongsToWorkspace(entry: ProcessEntry, workspace: string): Promise<boolean> {
	if (entry.command.includes(workspace)) return true;
	try {
		const { stdout } = await run("lsof", ["-a", "-d", "cwd", "-p", String(entry.pid), "-Fn"]);
		return lsofField(stdout, "n").some((path) => resolve(path).startsWith(workspace));
	} catch {
		return false;
	}
}
async function listeningPorts(processes: ProcessEntry[]) {
	const ports = await Promise.all(
		processes.map(async ({ pid, command }) => {
			try {
				const { stdout } = await run("lsof", [
					"-nP",
					"-a",
					"-p",
					String(pid),
					"-iTCP",
					"-sTCP:LISTEN",
					"-Fn",
				]);
				return lsofField(stdout, "n").flatMap((address) => {
					const port = LISTEN_ADDRESS.exec(address)?.[1];
					return port ? [{ port: Number(port), pid, command }] : [];
				});
			} catch {
				// lsof exits non-zero when the process listens on nothing.
				return [];
			}
		}),
	);
	return ports.flat();
}
async function pathManifest(path: string): Promise<PathManifest> {
	const info = await stat(path).catch(() => undefined);
	if (!info) return { exists: false, files: 0, bytes: 0 };
	if (!info.isDirectory()) return { exists: true, files: 1, bytes: info.size };
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
export async function observeEnvironment(input: {
	baseline: EnvironmentBaseline;
	workspace: string;
	observe: ObserveEnvironment;
}): Promise<EnvironmentObservation> {
	const { baseline, workspace, observe } = input;
	const table = await processTable();
	const started = (table ?? []).filter(({ pid }) => !baseline.pids.has(pid) && pid !== process.pid);
	const owned = await Promise.all(
		started.map(async (entry) =>
			(await belongsToWorkspace(entry, workspace)) ? entry : undefined,
		),
	);
	const processes = owned.flatMap((entry) => (entry ? [entry] : []));
	const paths = await Promise.all(
		(observe.paths ?? []).map(
			async (path) => [path, await pathManifest(join(workspace, path))] as const,
		),
	);
	return {
		processesKnown: table !== undefined,
		processes,
		listeningPorts: await listeningPorts(processes),
		paths: Object.fromEntries(paths),
	};
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
