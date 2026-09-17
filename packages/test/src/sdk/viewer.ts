import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ViewerCatalog, ViewerJob } from "../viewer/catalog.js";
import type { ViewerEvent } from "../viewer/events.js";
import type { ViewerRunner } from "../viewer/run-controller.js";
import { listenViewer } from "../viewer/server.js";
import { playwrightCli } from "./cli.js";
import { type TestEntry, ViewerTestResult, type WireEvent } from "./viewer-results.js";

function parseEvent(line: string, receive: (event: WireEvent) => void) {
	let event: WireEvent;
	try {
		event = JSON.parse(line);
	} catch {
		return;
	}
	receive(event);
}
async function runPlaywright(
	config: string,
	args: string[],
	observer: { receive: (event: WireEvent) => void; signal?: AbortSignal },
): Promise<number> {
	const { receive, signal } = observer;
	return new Promise((resolveExit, reject) => {
		const child = spawn(
			process.execPath,
			[
				playwrightCli(),
				"test",
				"-c",
				config,
				"--reporter",
				fileURLToPath(new URL("./reporter.js", import.meta.url)),
				...args,
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, AGENT_TEST_VIEWER_EVENTS: "1" },
			},
		);
		let buffer = "",
			stderr = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			const lines = (buffer + chunk).split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				try {
					parseEvent(line, receive);
				} catch (error) {
					child.kill("SIGTERM");
					reject(error);
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-8192);
		});
		const abort = () => child.kill("SIGINT");
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", abort);
			if (code && !signal?.aborted && stderr) receive({ type: "error", message: stderr });
			resolveExit(code ?? 1);
		});
	});
}
export async function loadSdkCatalog(
	config: string,
): Promise<{ catalog: ViewerCatalog; tests: TestEntry[] }> {
	let tests: TestEntry[] = [];
	const errors: string[] = [];
	const code = await runPlaywright(config, ["--list"], {
		receive: (event) => {
			if (event.tests) tests = event.tests;
			if (event.message) errors.push(event.message);
		},
	});
	if (code) throw new Error(`Test discovery failed: ${errors.join("\n")}`);
	const catalog: ViewerCatalog = {
		suitesDir: config,
		defaultSelectedHosts: [...new Set(tests.map((test) => test.project))],
		suites: [],
	};
	for (const entry of tests) {
		let suite = catalog.suites.find(
			(suite) => suite.name === relative(dirname(config), entry.file),
		);
		if (!suite) {
			suite = { name: relative(dirname(config), entry.file), hosts: [], scenarios: [] };
			catalog.suites.push(suite);
		}
		if (!suite.hosts.includes(entry.project)) suite.hosts.push(entry.project);
		if (!suite.scenarios.some((scenario) => scenario.name === entry.title))
			suite.scenarios.push({
				name: entry.title,
				authoring: "typescript",
				prompt: "Prompt and variants are defined when this test executes.",
				rubric: {},
				contextMode: "host-native",
			});
	}
	return { catalog, tests };
}
async function executeViewerJob(
	config: string,
	entry: TestEntry,
	job: { result: ViewerTestResult; signal: AbortSignal },
) {
	const selectionDir = await mkdtemp(join(tmpdir(), "agent-test-selection-"));
	const selectionFile = join(selectionDir, "tests.txt");
	const outputDir = join(dirname(config), "test-results", "agent-viewer", crypto.randomUUID());
	try {
		await writeFile(
			selectionFile,
			`${entry.project === "default" ? "" : `[${entry.project}] › `}${entry.listFile} › ${entry.title}\n`,
		);
		await mkdir(outputDir, { recursive: true });
		return await runPlaywright(
			config,
			["--test-list", selectionFile, "--workers", "1", "--output", outputDir],
			{ receive: (wire) => job.result.receive(wire), signal: job.signal },
		);
	} finally {
		await rm(selectionDir, { recursive: true, force: true });
	}
}
export function sdkViewerRunner(config: string, tests: TestEntry[]): ViewerRunner {
	return {
		async runJob(job: ViewerJob, emit: (event: ViewerEvent) => void, signal: AbortSignal) {
			const entry = tests.find(
				(test) =>
					relative(dirname(config), test.file) === job.suite &&
					test.title === job.scenario &&
					test.project === job.host,
			);
			if (!entry) throw new Error("Test is no longer in the discovered catalog");
			const result = new ViewerTestResult(job, emit);
			result.start();
			const code = await executeViewerJob(config, entry, { result, signal });
			result.finish(code, signal.aborted);
		},
	};
}
export async function startSdkViewer(
	config = resolve("agent-test.config.ts"),
	port = 0,
): Promise<number> {
	const { catalog, tests } = await loadSdkCatalog(config);
	const handle = await listenViewer({
		catalog,
		runner: sdkViewerRunner(config, tests),
		cwd: process.cwd(),
		suitesDir: config,
		workers: 1,
		port,
	});
	console.log(`Agent test viewer: ${handle.url}`);
	await new Promise<void>((resolveClose) => {
		const stop = () => {
			void handle.close().then(resolveClose);
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
	return 0;
}

export async function runSdkViewerCli(args: string[]): Promise<number> {
	const { values } = parseArgs({
		args,
		options: { config: { type: "string", short: "c" }, port: { type: "string" } },
	});
	const port = Number(values.port ?? "0");
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error("Port must be an integer from 0 through 65535");
	return startSdkViewer(resolve(values.config ?? "agent-test.config.ts"), port);
}
