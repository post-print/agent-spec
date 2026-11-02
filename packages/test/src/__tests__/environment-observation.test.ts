import { afterEach, describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEnvironmentBaseline, observeEnvironment } from "../sdk/environment-observation.js";
import { ConditionsUnknownError } from "../sdk/run-record.js";

const ORIGINAL_PATH = process.env.PATH;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	process.env.PATH = ORIGINAL_PATH;
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function temporaryDirectory(): Promise<string> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "environment-")));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return directory;
}
async function survivorIn(cwd: string): Promise<ChildProcess> {
	const child = spawn("sleep", ["30"], { cwd, stdio: "ignore" });
	cleanups.push(() => void child.kill("SIGKILL"));
	await new Promise((resolve) => setTimeout(resolve, 100));
	return child;
}
/** Leave only the named tools on PATH, so the others read as not installed. */
async function onlyTools(...names: string[]): Promise<void> {
	const directory = await temporaryDirectory();
	for (const name of names) {
		const source = await firstExisting(["/bin", "/usr/bin", "/usr/sbin"].map((d) => join(d, name)));
		await symlink(source, join(directory, name));
	}
	process.env.PATH = directory;
}
async function firstExisting(paths: string[]): Promise<string> {
	for (const path of paths) if (await realpath(path).catch(() => undefined)) return path;
	throw new Error(`None exist: ${paths.join(", ")}`);
}
function errorFrom(read: () => unknown): unknown {
	try {
		read();
		return undefined;
	} catch (error) {
		return error;
	}
}
/** True when the observation says it does not know, and reading its lists gives no verdict. */
function readsAsUnknown(observed: Awaited<ReturnType<typeof observeEnvironment>>): boolean {
	return (
		!observed.processesKnown &&
		errorFrom(() => observed.processes) instanceof ConditionsUnknownError &&
		errorFrom(() => observed.listeningPorts) instanceof ConditionsUnknownError
	);
}

describe("environment observation that could not be made", () => {
	it("reads as unknown when lsof is missing and a process may be left behind", async () => {
		const workspace = await temporaryDirectory();
		const baseline = await captureEnvironmentBaseline();
		await survivorIn(workspace);
		await onlyTools("ps");
		expect(readsAsUnknown(await observeEnvironment({ baseline, workspace, observe: {} }))).toBe(
			true,
		);
	});
	it("reads as unknown when ps is missing", async () => {
		const workspace = await temporaryDirectory();
		const baseline = await captureEnvironmentBaseline();
		await onlyTools();
		expect(readsAsUnknown(await observeEnvironment({ baseline, workspace, observe: {} }))).toBe(
			true,
		);
	});
	it("reads as unknown when the baseline itself could not be taken", async () => {
		const workspace = await temporaryDirectory();
		await onlyTools();
		const baseline = await captureEnvironmentBaseline();
		process.env.PATH = ORIGINAL_PATH;
		expect(readsAsUnknown(await observeEnvironment({ baseline, workspace, observe: {} }))).toBe(
			true,
		);
	});
	it("still lists for the runtime what it could see, so teardown can stop it", async () => {
		const workspace = await temporaryDirectory();
		const baseline = await captureEnvironmentBaseline();
		const script = join(workspace, "server.sh");
		await writeFile(script, "sleep 30");
		const child = spawn("sh", [script], { stdio: "ignore" });
		cleanups.push(() => void child.kill("SIGKILL"));
		await new Promise((resolve) => setTimeout(resolve, 100));
		await onlyTools("ps");
		const observed = await observeEnvironment({ baseline, workspace, observe: {} });
		expect(readsAsUnknown(observed)).toBe(true);
		expect(observed.stoppablePids).toContain(child.pid as number);
	});
});

describe("environment observation evidence", () => {
	it("keeps an unknown observation serializable, stating only what is known", async () => {
		const workspace = await temporaryDirectory();
		const baseline = await captureEnvironmentBaseline();
		await onlyTools();
		const observed = await observeEnvironment({ baseline, workspace, observe: {} });
		expect(JSON.parse(JSON.stringify(observed))).toEqual({
			processesKnown: false,
			stoppablePids: [],
			paths: {},
		});
	});
	it("answers normally when nothing started, without needing lsof", async () => {
		const workspace = await temporaryDirectory();
		const baseline = await captureEnvironmentBaseline();
		await onlyTools("ps");
		const observed = await observeEnvironment({ baseline, workspace, observe: {} });
		// Anything else that starts on this machine now would rightly make the answer unknown.
		expect(observed.processesKnown ? observed.processes : []).toEqual([]);
	});
	it("does not call an unreadable path absent", async () => {
		const workspace = await temporaryDirectory();
		const locked = join(workspace, "locked");
		await mkdir(locked);
		await writeFile(join(locked, "file"), "x");
		await chmod(locked, 0o000);
		cleanups.unshift(() => chmod(locked, 0o700));
		const observed = await observeEnvironment({
			baseline: await captureEnvironmentBaseline(),
			workspace,
			observe: { paths: ["locked", "locked/file", "missing"] },
		});
		expect(() => observed.paths.locked?.exists).toThrow(ConditionsUnknownError);
		expect(() => observed.paths["locked/file"]?.exists).toThrow(ConditionsUnknownError);
		expect(observed.paths.missing?.exists).toBe(false);
	});
	it("does not take a process in a sibling folder for the workspace's", async () => {
		const workspace = await temporaryDirectory();
		const sibling = `${workspace}-sibling`;
		await mkdir(sibling);
		cleanups.push(() => rm(sibling, { recursive: true, force: true }));
		const baseline = await captureEnvironmentBaseline();
		const child = await survivorIn(sibling);
		const observed = await observeEnvironment({ baseline, workspace, observe: {} });
		expect(observed.processes.map(({ pid }) => pid)).not.toContain(child.pid as number);
	});
});
