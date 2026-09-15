import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { HostAuthMode } from "@post-print/agent-harness";
import type { SuiteRunReport } from "./types.js";
import type { ViewerRunRequest } from "./viewer/catalog.js";

/** Preview process exits after this idle time. */
export const REPORT_PREVIEW_IDLE_MS = 30 * 60 * 1000;

export interface DetachedViewerManifest {
	/** CLI entrypoint that started this session; isolated reruns execute this, not the session server. */
	cliPath?: string;
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
	judge?: boolean;
	timeoutMs?: number;
	authMode?: HostAuthMode;
	adapterModules?: string[];
	workers?: number;
	worktree?: boolean;
	keepRecordings?: boolean;
	allowUserInput?: boolean;
	debug?: boolean;
	debugDir?: string;
	request?: ViewerRunRequest;
	reports: SuiteRunReport[];
}

const PREVIEW_HOST = "127.0.0.1";

export function shouldStartReportPreview(
	env: NodeJS.ProcessEnv = process.env,
	stdoutIsTty = Boolean(process.stdout.isTTY),
): boolean {
	if (env.CI === "1" || env.CI === "true") {
		return false;
	}
	if (env.AGENT_TEST_NO_REPORT_PREVIEW === "1") {
		return false;
	}
	return stdoutIsTty;
}

export function listenReportPreview(
	filePath: string,
	options: { idleMs?: number } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
	const absolutePath = resolve(filePath);
	const idleMs = options.idleMs;
	return new Promise((resolveListen, reject) => {
		let idle: ReturnType<typeof setTimeout> | undefined;
		const bumpIdle = (): void => {
			if (idleMs === undefined) {
				return;
			}
			if (idle !== undefined) {
				clearTimeout(idle);
			}
			idle = setTimeout(() => {
				void close();
			}, idleMs);
		};
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			bumpIdle();
			void serveReportFile(absolutePath, req, res);
		});
		const close = (): Promise<void> =>
			new Promise((resolveClose, rejectClose) => {
				if (idle !== undefined) {
					clearTimeout(idle);
					idle = undefined;
				}
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		server.once("error", reject);
		server.listen(0, PREVIEW_HOST, () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("report preview has no port"));
				return;
			}
			bumpIdle();
			resolveListen({ url: `http://${PREVIEW_HOST}:${addr.port}/`, close });
		});
	});
}

export async function startDetachedReportPreview(filePath: string): Promise<string | undefined> {
	const serverPath = resolvePreviewServerEntry();
	if (!serverPath) {
		return undefined;
	}
	const child = spawn(
		process.execPath,
		[serverPath, resolve(filePath), String(REPORT_PREVIEW_IDLE_MS)],
		{
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	if (!child.stdout) {
		child.kill();
		return undefined;
	}
	try {
		const line = await readFirstLine(child.stdout, 3000);
		if (!isLocalPreviewUrl(line)) {
			child.kill();
			return undefined;
		}
		child.stdout.destroy();
		child.unref();
		return line;
	} catch {
		killPreviewChild(child);
		return undefined;
	}
}

/** Start the active unified viewer around one completed CLI run. */
export async function startDetachedViewer(
	manifest: DetachedViewerManifest,
): Promise<string | undefined> {
	const serverPath = resolveViewerServerEntry();
	if (!serverPath) return undefined;
	const manifestDir = await mkdtemp(join(tmpdir(), "agent-test-viewer-"));
	const manifestPath = join(manifestDir, "session.json");
	await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
	const child = spawn(
		process.execPath,
		[serverPath, manifestPath, String(REPORT_PREVIEW_IDLE_MS)],
		{
			detached: true,
			stdio: ["ignore", "pipe", "ignore"],
		},
	);
	if (!child.stdout) {
		child.kill();
		await rm(manifestDir, { recursive: true, force: true });
		return undefined;
	}
	try {
		const line = await readFirstLine(child.stdout, 3000);
		if (!isLocalPreviewUrl(line)) {
			child.kill();
			await rm(manifestDir, { recursive: true, force: true });
			return undefined;
		}
		child.stdout.destroy();
		child.unref();
		return line;
	} catch {
		killPreviewChild(child);
		await rm(manifestDir, { recursive: true, force: true });
		return undefined;
	}
}

function isLocalPreviewUrl(url: string): boolean {
	return /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url);
}

function resolvePreviewServerEntry(): string | undefined {
	const js = fileURLToPath(new URL("./report-preview-server.js", import.meta.url));
	const ts = fileURLToPath(new URL("./report-preview-server.ts", import.meta.url));
	if (existsSync(js)) {
		return js;
	}
	if (existsSync(ts)) {
		return ts;
	}
	return undefined;
}

function resolveViewerServerEntry(): string | undefined {
	const js = fileURLToPath(new URL("./viewer/session-server.js", import.meta.url));
	const ts = fileURLToPath(new URL("./viewer/session-server.ts", import.meta.url));
	if (existsSync(js)) return js;
	if (existsSync(ts)) return ts;
	return undefined;
}

function killPreviewChild(child: ChildProcess): void {
	if (!child.killed) {
		child.kill();
	}
}

function readFirstLine(stream: Readable, timeoutMs: number): Promise<string> {
	return new Promise((resolveLine, reject) => {
		let buf = "";
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("report preview timed out"));
		}, timeoutMs);
		const onData = (chunk: Buffer | string): void => {
			buf += String(chunk);
			const nl = buf.indexOf("\n");
			if (nl === -1) {
				return;
			}
			cleanup();
			resolveLine(buf.slice(0, nl).trim());
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const cleanup = (): void => {
			clearTimeout(timer);
			stream.off("data", onData);
			stream.off("error", onError);
		};
		stream.on("data", onData);
		stream.on("error", onError);
	});
}

async function serveReportFile(
	filePath: string,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const url = req.url ?? "/";
	const path = url.split("?")[0] ?? "/";
	if (req.method !== "GET" || (path !== "/" && path !== "/index.html")) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const body = await readFile(filePath);
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
