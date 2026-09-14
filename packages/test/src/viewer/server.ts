import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { DEFAULT_VIEWER_WORKERS } from "../worker-pool.js";
import type { ViewerCatalog, ViewerRunRequest } from "./catalog.js";
import { encodeViewerEvent, type ViewerEvent } from "./events.js";
import { createLiveViewerRunner, type LiveViewerRunnerOptions } from "./live-runner.js";
import { renderViewerPage } from "./page.js";
import {
	createViewerRunController,
	followViewerRun,
	type ViewerRunController,
	type ViewerRunner,
} from "./run-controller.js";

const VIEWER_HOST = "127.0.0.1";

export interface ListenViewerOptions extends LiveViewerRunnerOptions {
	catalog: ViewerCatalog;
	port?: number;
	runner?: ViewerRunner;
	/** Parallel live agents. Default 4. */
	workers?: number;
}

export interface ViewerServerHandle {
	url: string;
	close: () => Promise<void>;
}

export async function listenViewer(options: ListenViewerOptions): Promise<ViewerServerHandle> {
	const controller = createViewerRunController({
		catalog: options.catalog,
		runner: options.runner ?? createLiveViewerRunner(options),
		maxParallelAgents: options.workers ?? DEFAULT_VIEWER_WORKERS,
	});
	const server = createServer((req, res) => {
		void handleViewerRequest(req, res, options.catalog, controller);
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, VIEWER_HOST, () => resolveListen());
	});
	const addr = server.address();
	if (!addr || typeof addr === "string") {
		server.close();
		throw new Error("viewer has no port");
	}
	return {
		url: `http://${VIEWER_HOST}:${addr.port}/`,
		close: () =>
			new Promise((resolveClose, rejectClose) => {
				const active = controller.activeRunId();
				if (active) {
					controller.cancel(active);
				}
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			}),
	};
}

async function handleViewerRequest(
	req: IncomingMessage,
	res: ServerResponse,
	catalog: ViewerCatalog,
	controller: ViewerRunController,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = url.pathname;
	if (req.method === "GET" && (path === "/" || path === "/index.html")) {
		write(res, 200, "text/html; charset=utf-8", renderViewerPage(catalog));
		return;
	}
	if (req.method === "GET" && path === "/api/catalog") {
		writeJson(res, 200, catalog);
		return;
	}
	if (req.method === "POST" && path === "/api/runs") {
		let request: ViewerRunRequest;
		try {
			request = (await readJson(req)) as ViewerRunRequest;
		} catch (error) {
			writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
			return;
		}
		try {
			const started = controller.start(request);
			writeJson(res, 202, started);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("already in progress") ? 409 : 400;
			writeJson(res, status, { error: message });
		}
		return;
	}
	const runMatch = path.match(/^\/api\/runs\/([^/]+)\/events$/);
	if (req.method === "GET" && runMatch?.[1]) {
		streamEvents(res, controller, runMatch[1]);
		return;
	}
	const cancelMatch = path.match(/^\/api\/runs\/([^/]+)\/cancel$/);
	if (req.method === "POST" && cancelMatch?.[1]) {
		const cancelled = controller.cancel(cancelMatch[1]);
		writeJson(res, cancelled ? 200 : 404, { cancelled });
		return;
	}
	res.writeHead(404);
	res.end();
}

function streamEvents(res: ServerResponse, controller: ViewerRunController, runId: string): void {
	if (!controller.history(runId)) {
		writeJson(res, 404, { error: "Run not found" });
		return;
	}
	res.writeHead(200, {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});
	const writeEvent = (event: ViewerEvent): boolean => {
		res.write(`data: ${encodeViewerEvent(event)}\n\n`);
		return event.type === "run_finished";
	};
	let unsubscribe: (() => void) | undefined;
	let ended = false;
	const finish = (): void => {
		if (ended) {
			return;
		}
		ended = true;
		unsubscribe?.();
		res.end();
	};
	unsubscribe = followViewerRun(controller, runId, (event) => {
		if (writeEvent(event)) {
			finish();
		}
	});
	if (ended) {
		unsubscribe?.();
		return;
	}
	reqOnClose(res, finish);
}

function reqOnClose(res: ServerResponse, unsubscribe: () => void): void {
	res.on("close", unsubscribe);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 1_000_000) {
			throw new Error("Request body is too large");
		}
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) {
		return {};
	}
	return JSON.parse(raw) as unknown;
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	write(res, status, "application/json; charset=utf-8", `${JSON.stringify(body)}\n`);
}

function write(res: ServerResponse, status: number, contentType: string, body: string): void {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
	});
	res.end(body);
}
