import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listenViewer } from "../viewer/server.js";
import {
	createTestCatalog,
	type PlaywrightTestEntry,
	type TestCatalog,
} from "../viewer/test-catalog.js";
import { playwrightCli } from "./playwright-cli.js";

type DiscoveryMessage = { type: string; tests?: PlaywrightTestEntry[]; message?: string };

export async function loadSdkCatalog(config: string): Promise<TestCatalog> {
	let tests: PlaywrightTestEntry[] = [];
	const errors: string[] = [];
	const code = await runDiscovery(config, (event) => {
		if (event.type === "catalog" && event.tests) tests = event.tests;
		if (event.type === "error" && event.message) errors.push(event.message);
	});
	if (code) throw new Error(`Test discovery failed: ${errors.join("\n")}`);
	return createTestCatalog(config, tests);
}

function runDiscovery(config: string, receive: (event: DiscoveryMessage) => void): Promise<number> {
	return new Promise((resolveExit, reject) => {
		const child = spawn(
			process.execPath,
			[playwrightCli(), "test", "--config", config, "--list", "--reporter", discoveryReporter()],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let buffered = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			const lines = `${buffered}${chunk}`.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) receiveDiscovery(line, receive);
		});
		child.once("error", reject);
		child.once("close", (code) => resolveExit(code ?? 1));
	});
}

function discoveryReporter(): string {
	return fileURLToPath(new URL("./reporter.js", import.meta.url));
}
function receiveDiscovery(line: string, receive: (event: DiscoveryMessage) => void): void {
	try {
		receive(JSON.parse(line) as DiscoveryMessage);
	} catch {
		/* Ignore Playwright setup output. */
	}
}

export async function startSdkViewer(config: string, port = 0): Promise<number> {
	const handle = await listenViewer({
		suitesDir: config,
		testCatalog: await loadSdkCatalog(config),
		refreshTestCatalog: () => loadSdkCatalog(config),
		port,
	});
	console.log(`Agent test viewer: ${handle.url}`);
	await waitForViewerClose(handle.close);
	return 0;
}

function waitForViewerClose(close: () => Promise<void>): Promise<void> {
	return new Promise((resolveClose) => {
		const stop = () => void close().then(resolveClose);
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

export async function runSdkViewerCli(args: string[]): Promise<number> {
	const { values } = parseArgs({
		args,
		options: { config: { type: "string", short: "c" }, port: { type: "string" } },
	});
	const port = Number(values.port ?? "0");
	if (!Number.isInteger(port) || port < 0 || port > 65535)
		throw new Error("Port must be an integer from 0 through 65535");
	return startSdkViewer(values.config ?? "agent-test.config.ts", port);
}
