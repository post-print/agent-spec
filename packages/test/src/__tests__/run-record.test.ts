import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listMcpCatalog } from "@post-print/agent-harness";
import { captureEnvironmentBaseline, observeEnvironment } from "../sdk/environment-observation.js";
import { expect as agentExpect } from "../sdk/expect.js";
import {
	buildRunRecord,
	ConditionsUnknownError,
	ENFORCED_VECTORS,
	offeredTool,
	recordEscapeVector,
	recordHostCalibration,
	runExposure,
} from "../sdk/run-record.js";
import type { Run } from "../sdk/types.js";
import { runConditionLabels } from "../viewer/presentation.js";

const ECHO_SERVER = fileURLToPath(new URL("../../fixtures/mcp-echo/server.mjs", import.meta.url));
const CONDITIONS = {
	host: "claude",
	binaryVersion: "1.0.0 (Claude Code)",
	confinement: "host-enforced" as const,
	network: "unknown" as const,
	authMode: "subscription",
	userConfig: "may-load" as const,
	overridingEnv: [],
};
const CONTEXT = { instructions: [], files: [], skills: [], includeGlobalSkills: false };
const SNAPSHOT = { path: "/x", files: { "a.txt": { sha256: "abc", bytes: 1 } } };
const BASE = { baseDir: "/does-not-exist", packageVersion: "9", suiteHash: "s" };

describe("run exposure", () => {
	it("trusts the host's own tool list and adds server descriptions", () => {
		const exposure = runExposure(
			{
				tools: ["Bash", "mcp__tasks__get_task"],
				mcpServers: [{ name: "tasks", status: "connected" }],
			},
			[
				{
					server: "tasks",
					status: "listed",
					tools: [{ name: "get_task", description: "Read one task" }],
				},
			],
		);
		expect(exposure.source).toBe("host");
		expect(exposure.tools[1]).toEqual({
			name: "mcp__tasks__get_task",
			server: "tasks",
			description: "Read one task",
		});
		expect(offeredTool(exposure, "get_task")).toBe(true);
		expect(offeredTool(exposure, "Bash")).toBe(true);
		expect(offeredTool(exposure, "search")).toBe(false);
	});
	it("falls back to asking the servers when the host reports nothing", () => {
		const exposure = runExposure(undefined, [
			{ server: "tasks", status: "listed", tools: [{ name: "get_task" }] },
		]);
		expect(exposure.source).toBe("mcp-query");
		expect(offeredTool(exposure, "get_task")).toBe(true);
		expect(offeredTool(exposure, "missing")).toBe(false);
	});
	it("answers neither yes nor no when nothing is known", () => {
		const unknown = runExposure(undefined, []);
		expect(unknown.source).toBe("unknown");
		expect(() => offeredTool(unknown, "get_task")).toThrow(ConditionsUnknownError);
		const failed = runExposure(undefined, [{ server: "tasks", status: "failed", error: "boom" }]);
		expect(failed.source).toBe("unknown");
		expect(failed.mcpServers[0]).toEqual({ name: "tasks", status: "failed", error: "boom" });
	});
	it("a matcher on an unknown catalog cannot pass in either direction", () => {
		const run = { exposure: runExposure(undefined, []) } as unknown as Run;
		expect(() => agentExpect(run).toHaveBeenOffered("x")).toThrow(ConditionsUnknownError);
		expect(() => agentExpect(run).not.toHaveBeenOffered("x")).toThrow(ConditionsUnknownError);
	});
});

describe("MCP catalog", () => {
	it("lists a real stdio server's tools with descriptions", async () => {
		const [entry] = await listMcpCatalog(
			{ echo: { type: "stdio", command: "node", args: [ECHO_SERVER] } },
			{ cwd: tmpdir() },
		);
		if (entry?.status !== "listed") throw new Error("Expected the server to list its tools");
		expect(entry.tools.map(({ name }) => name)).toContain("get_task");
		expect(entry.tools.every(({ description }) => typeof description === "string")).toBe(true);
	});
	it("reports a server that fails instead of throwing", async () => {
		const [entry] = await listMcpCatalog(
			{ broken: { type: "stdio", command: "/does/not/exist" } },
			{ cwd: tmpdir() },
		);
		expect(entry?.status).toBe("failed");
	});
});

describe("run record", () => {
	const input = {
		conditions: CONDITIONS,
		definition: { options: { model: "m1" } },
		hostReport: { model: "m1-observed", version: "1.0.1" },
		prompt: "hello",
		context: CONTEXT,
		initial: SNAPSHOT,
	};
	it("records conditions, prefers what the host reported, and hashes what shaped the run", async () => {
		const record = await buildRunRecord(BASE, input);
		expect(record).toMatchObject({
			host: "claude",
			binaryVersion: "1.0.1",
			requestedModel: "m1",
			observedModel: "m1-observed",
			modelPinned: true,
			calibrated: false,
			packageVersion: "9",
		});
		expect(record.hashes.prompt).toHaveLength(64);
		const other = await buildRunRecord(BASE, { ...input, prompt: "hello!" });
		expect(other.hashes.prompt).not.toBe(record.hashes.prompt);
		const changed = { path: "/x", files: { "a.txt": { sha256: "def", bytes: 1 } } };
		const moved = await buildRunRecord(BASE, { ...input, initial: changed });
		expect(moved.hashes.initialSnapshot).not.toBe(record.hashes.initialSnapshot);
	});
	it("is unpinned when no definition names a model", async () => {
		const record = await buildRunRecord(BASE, { ...input, definition: { options: {} } });
		expect(record.modelPinned).toBe(false);
	});
});

describe("host calibration", () => {
	const input = {
		conditions: CONDITIONS,
		definition: { options: { model: "m1" } },
		hostReport: { model: "m1-observed", version: "1.0.1" },
		prompt: "hello",
		context: CONTEXT,
		initial: SNAPSHOT,
	};
	it("reads as calibrated only after a probe passed for that host version and auth mode", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "calibration-"));
		try {
			const key = { host: "claude", binaryVersion: "1.0.1", authMode: "subscription" };
			await recordHostCalibration(baseDir, key);
			const base = { ...BASE, baseDir };
			expect((await buildRunRecord(base, input)).calibrated).toBe(true);
			const upgraded = { ...input, hostReport: { version: "1.0.2" } };
			expect((await buildRunRecord(base, upgraded)).calibrated).toBe(false);
			const apiKey = { ...input, conditions: { ...CONDITIONS, authMode: "api-key" } };
			expect((await buildRunRecord(base, apiKey)).calibrated).toBe(false);
		} finally {
			await rm(baseDir, { recursive: true, force: true });
		}
	});
	it("a calibration older than a week no longer counts", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "calibration-"));
		try {
			const key = { host: "claude", binaryVersion: "1.0.1", authMode: "subscription" };
			await recordHostCalibration(baseDir, key);
			const [file = ""] = await readdir(join(baseDir, ".agent-test", "calibration"));
			const path = join(baseDir, ".agent-test", "calibration", file);
			const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
			await writeFile(path, JSON.stringify({ ...key, at: stale }));
			expect((await buildRunRecord({ ...BASE, baseDir }, input)).calibrated).toBe(false);
		} finally {
			await rm(baseDir, { recursive: true, force: true });
		}
	});
});

describe("escape battery calibration", () => {
	const input = {
		conditions: CONDITIONS,
		definition: { options: { model: "m1" } },
		hostReport: { model: "m1-observed", version: "1.0.1" },
		prompt: "hello",
		context: CONTEXT,
		initial: SNAPSHOT,
	};
	it("proves confinement only when every enforced escape vector held", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "calibration-"));
		try {
			const key = { host: "claude", binaryVersion: "1.0.1", authMode: "subscription" };
			for (const vector of ENFORCED_VECTORS)
				await recordEscapeVector(baseDir, key, { vector, held: true });
			const base = { ...BASE, baseDir };
			expect((await buildRunRecord(base, input)).confinementProven).toBe(true);
			await recordEscapeVector(baseDir, key, { vector: "symlink-out", held: false });
			expect((await buildRunRecord(base, input)).confinementProven).toBe(false);
		} finally {
			await rm(baseDir, { recursive: true, force: true });
		}
	});
});

describe("viewer condition labels", () => {
	const op = (record: object) => ({ data: [{ record }] });
	it("states what limits a pass", () => {
		expect(
			runConditionLabels([
				op({ host: "cursor", confinement: "detect-only", calibrated: false, modelPinned: false }),
			]),
		).toEqual(["Unconfined", "Uncalibrated", "Model unpinned"]);
	});
	it("stays quiet for a calibrated pinned run and for runs with no record", () => {
		expect(
			runConditionLabels([
				op({ host: "claude", confinement: "host-enforced", calibrated: true, modelPinned: true }),
				{ data: [{}, null] },
			]),
		).toEqual([]);
	});
	it("names a run the host's own user config may reach", () => {
		const record = { host: "claude", calibrated: true, modelPinned: true, userConfig: "may-load" };
		expect(runConditionLabels([op(record)])).toEqual(["User config may load"]);
	});
});

describe("environment observation", () => {
	it("finds a process left behind in the workspace, its port, and a path outside snapshots", async () => {
		const workspace = await realpath(await mkdtemp(join(tmpdir(), "environment-")));
		await mkdir(join(workspace, "node_modules", "pkg"), { recursive: true });
		await writeFile(join(workspace, "node_modules", "pkg", "index.js"), "12345");
		const baseline = await captureEnvironmentBaseline();
		const server = spawn(
			"node",
			["-e", "require('net').createServer().listen(0, '127.0.0.1', () => console.log('up'))"],
			{ cwd: workspace, stdio: ["ignore", "pipe", "ignore"] },
		);
		await new Promise((resolve) => server.stdout.once("data", resolve));
		try {
			const observed = await observeEnvironment({
				baseline,
				workspace,
				observe: { paths: ["node_modules", "absent"] },
			});
			expect(observed.processesKnown).toBe(true);
			expect(observed.processes.map(({ pid }) => pid)).toContain(server.pid as number);
			expect(observed.listeningPorts.map(({ pid }) => pid)).toContain(server.pid as number);
			expect(observed.paths.node_modules).toEqual({ exists: true, files: 1, bytes: 5 });
			expect(observed.paths.absent).toEqual({ exists: false, files: 0, bytes: 0 });
		} finally {
			server.kill("SIGKILL");
			await rm(workspace, { recursive: true, force: true });
		}
	});
	it("does not count a process that was already running", async () => {
		const workspace = await realpath(await mkdtemp(join(tmpdir(), "environment-")));
		const server = spawn("sleep", ["30"], { cwd: workspace });
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			const baseline = await captureEnvironmentBaseline();
			const observed = await observeEnvironment({ baseline, workspace, observe: {} });
			expect(observed.processes.map(({ pid }) => pid)).not.toContain(server.pid as number);
		} finally {
			server.kill("SIGKILL");
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
