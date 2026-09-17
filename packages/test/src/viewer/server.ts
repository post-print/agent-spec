import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DEFAULT_VIEWER_WORKERS, MAX_WORKERS } from "../worker-pool.js";
import type { ViewerCatalog, ViewerRunRequest } from "./catalog.js";
import {
	encodeViewerEvent,
	type ViewerBootstrap,
	type ViewerEvent,
	type ViewerRunRecord,
} from "./events.js";
import { renderViewerPage } from "./page.js";
import {
	createViewerRunController,
	type ViewerRunController,
	type ViewerRunner,
} from "./run-controller.js";
import { reportCss } from "./styles.js";

const RUN_ROUTE = /^\/api\/runs\/([^/]+)$/;
const EVENTS_ROUTE = /^\/api\/runs\/([^/]+)\/events$/;
const CANCEL_ROUTE = /^\/api\/runs\/([^/]+)\/cancel$/;

const VIEWER_HOST = "127.0.0.1";

export interface ListenViewerOptions {
	cwd: string;
	suitesDir: string;
	catalog: ViewerCatalog;
	port?: number;
	runner: ViewerRunner;
	/** Parallel live agents. Default 4. */
	workers?: number;
	initialRuns?: ViewerRunRecord[];
	selectedRunId?: string;
	idleMs?: number;
	onClose?: () => void | Promise<void>;
}

export interface ViewerServerHandle {
	url: string;
	close: () => Promise<void>;
}

class ViewerServer {
	private idle: ReturnType<typeof setTimeout> | undefined;
	private closed = false;
	private readonly controller: ViewerRunController;
	private readonly server: ReturnType<typeof createServer>;
	constructor(private readonly options: ListenViewerOptions) {
		this.controller = createViewerRunController({
			catalog: options.catalog,
			runner: options.runner,
			maxParallelAgents: MAX_WORKERS,
			initialRuns: options.initialRuns,
		});
		this.server = createServer((req, res) => {
			this.bumpIdle();
			void handleViewerRequest(req, {
				res,
				catalog: options.catalog,
				controller: this.controller,
				selectedRunId: options.selectedRunId,
				workspace: options.cwd,
				defaultWorkers: options.workers ?? DEFAULT_VIEWER_WORKERS,
			});
		});
	}
	private bumpIdle(): void {
		if (!this.options.idleMs) return;
		if (this.idle) clearTimeout(this.idle);
		this.idle = setTimeout(() => {
			void this.close();
		}, this.options.idleMs);
	}
	close = (): Promise<void> =>
		new Promise((resolve, reject) => {
			if (this.closed) {
				resolve();
				return;
			}
			this.closed = true;
			if (this.idle) {
				clearTimeout(this.idle);
				this.idle = undefined;
			}
			const active = this.controller.activeRunId();
			if (active) this.controller.cancel(active);
			this.server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				Promise.resolve(this.options.onClose?.()).then(() => resolve(), reject);
			});
		});
	async listen(): Promise<ViewerServerHandle> {
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.options.port ?? 0, VIEWER_HOST, resolve);
		});
		const addr = this.server.address();
		if (!addr || typeof addr === "string") {
			this.server.close();
			throw new Error("viewer has no port");
		}
		this.bumpIdle();
		return { url: `http://${VIEWER_HOST}:${addr.port}/`, close: this.close };
	}
}
export async function listenViewer(options: ListenViewerOptions): Promise<ViewerServerHandle> {
	return new ViewerServer(options).listen();
}

interface ViewerRequestContext {
	res: ServerResponse;
	catalog: ViewerCatalog;
	controller: ViewerRunController;
	selectedRunId?: string;
	workspace?: string;
	defaultWorkers?: number;
}
async function handleViewerRequest(
	req: IncomingMessage,
	context: ViewerRequestContext,
): Promise<void> {
	const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
	if (req.method === "GET" && handleGetRequest(path, req, context)) return;
	if (req.method === "POST" && (await handlePostRequest(path, req, context))) return;
	context.res.writeHead(404);
	context.res.end();
}
function handleGetRequest(
	path: string,
	req: IncomingMessage,
	context: ViewerRequestContext,
): boolean {
	const { res, catalog, controller } = context;
	if (path === "/" || path === "/index.html") {
		renderIndex(context);
		return true;
	}
	if (path === "/api/catalog") {
		writeJson(res, 200, catalog);
		return true;
	}
	if (path === "/api/runs") {
		writeJson(res, 200, controller.runs());
		return true;
	}
	const detail = path.match(RUN_ROUTE)?.[1];
	if (detail) {
		const run = controller.run(detail);
		writeJson(res, run ? 200 : 404, run ? { run } : { error: "Run not found" });
		return true;
	}
	const runId = path.match(EVENTS_ROUTE)?.[1];
	if (!runId) return false;
	streamEvents(res, { controller, runId, lastEventId: req.headers["last-event-id"] });
	return true;
}
async function handlePostRequest(
	path: string,
	req: IncomingMessage,
	context: ViewerRequestContext,
): Promise<boolean> {
	const { res, controller } = context;
	if (path === "/api/runs") {
		await startRequestedRun(req, res, controller);
		return true;
	}
	const runId = path.match(CANCEL_ROUTE)?.[1];
	if (!runId) return false;
	const cancelled = controller.cancel(runId);
	writeJson(res, cancelled ? 200 : 404, { cancelled });
	return true;
}

async function startRequestedRun(
	req: IncomingMessage,
	res: ServerResponse,
	controller: ViewerRunController,
): Promise<void> {
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
}
function renderIndex(context: ViewerRequestContext): void {
	const {
		res,
		catalog,
		controller,
		selectedRunId,
		workspace,
		defaultWorkers = DEFAULT_VIEWER_WORKERS,
	} = context;
	const runs = controller.runs();
	const activeRun = runs.find((run) => run.status === "running" || run.status === "cancelling");
	const bootstrap: ViewerBootstrap = {
		catalog,
		runs,
		selectedRunId: selectedRunId ?? activeRun?.id ?? runs.at(-1)?.id,
		workspace,
		capabilities: {
			canRun: true,
			defaultWorkers,
			maxWorkers: controller.maxParallelAgents(),
		},
	};
	write(res, {
		status: 200,
		contentType: "text/html; charset=utf-8",
		body: renderViewerPage(bootstrap, { baseCss: reportCss() }),
	});
}
function streamEvents(
	res: ServerResponse,
	{
		controller,
		runId,
		lastEventId,
	}: { controller: ViewerRunController; runId: string; lastEventId: string | string[] | undefined },
): void {
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
	let index = nextEventIndex(lastEventId);
	const writeEvent = (event: ViewerEvent): boolean => {
		res.write(`id: ${index++}\ndata: ${encodeViewerEvent(event)}\n\n`);
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
	const flush = (): void => {
		const history = controller.history(runId);
		if (!history) return;
		while (!ended && index < history.length) {
			if (writeEvent(history[index] as ViewerEvent)) finish();
		}
	};
	unsubscribe = controller.subscribe(runId, flush);
	flush();
	if (ended) {
		unsubscribe?.();
		return;
	}
	reqOnClose(res, finish);
}

function nextEventIndex(lastEventId: string | string[] | undefined): number {
	const raw = Array.isArray(lastEventId) ? lastEventId.at(-1) : lastEventId;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed + 1 : 0;
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
	write(res, {
		status: status,
		contentType: "application/json; charset=utf-8",
		body: `${JSON.stringify(body)}\n`,
	});
}

function write(
	res: ServerResponse,
	{ status, contentType, body }: { status: number; contentType: string; body: string },
): void {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
	});
	res.end(body);
}
