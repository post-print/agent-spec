import { type FSWatcher, watch } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import {
	type StartExecutionOptions,
	type StartedExecution,
	startRecordedExecution,
} from "../sdk/execution-runner.js";
import {
	executionHistoryRoot,
	listExecutionHistory,
	readExecutionDetail,
	recoverExecutionHistory,
} from "../sdk/execution-store.js";
import type { ViewerBootstrap } from "./bootstrap.js";
import { renderViewerPage } from "./page.js";
import { parseViewerClientMessage, VIEWER_PROTOCOL_VERSION } from "./protocol.js";
import { viewerCss } from "./styles.js";
import type { TestCatalog } from "./test-catalog.js";

const EXECUTION_ROUTE = /^\/api\/executions\/([0-9a-f-]+)$/;
const EXECUTION_CANCEL_ROUTE = /^\/api\/executions\/([0-9a-f-]+)\/cancel$/;
const VIEWER_ROUTE = /^\/(tests\/[^/]+|executions\/[0-9a-f-]+|compare\/[0-9a-f-]+\/[0-9a-f-]+)$/;
const DISCOVERY_FILE = /(^|\/)(agent-test\.config\.ts|[^/]+\.(spec|test)\.[cm]?[jt]sx?)$/;
const EXECUTION_FILE = /(^|\/)\.agent-test\/executions\/([^/]+)\//;
const VIEWER_HOST = "127.0.0.1";
const WEBSOCKET_OPEN = 1;

export interface ListenViewerOptions {
	suitesDir: string;
	testCatalog: TestCatalog;
	refreshTestCatalog?: () => Promise<TestCatalog>;
	port?: number;
	idleMs?: number;
	executionPollMs?: number;
	watchWorkspace?: boolean;
	onClose?: () => void | Promise<void>;
	startExecution?: (options: StartExecutionOptions) => Promise<StartedExecution>;
}
export interface ViewerServerHandle {
	url: string;
	close: () => Promise<void>;
}

class ViewerServer {
	private readonly server: ReturnType<typeof createServer>;
	private readonly sockets = new WebSocketServer({ noServer: true });
	private readonly subscribers = new Set<import("ws").WebSocket>();
	private readonly executions = new Map<string, StartedExecution>();
	private readonly socketToken = crypto.randomUUID();
	private idle: ReturnType<typeof setTimeout> | undefined;
	private historyRefresh: ReturnType<typeof setTimeout> | undefined;
	private executionPoll: ReturnType<typeof setInterval> | undefined;
	private pollingExecutions = false;
	private polledRunningExecutions = new Set<string>();
	private readonly executionRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
	private catalogRefresh: ReturnType<typeof setTimeout> | undefined;
	private historyWatcher: FSWatcher | undefined;
	private closed = false;
	private testCatalog: TestCatalog;

	constructor(private readonly options: ListenViewerOptions) {
		this.testCatalog = options.testCatalog;
		this.server = createServer((request, response) => {
			this.bumpIdle();
			void this.handleRequest(request, response);
		});
		this.server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
		if (options.watchWorkspace !== false) this.watchWorkspace();
	}
	private watchWorkspace(): void {
		try {
			this.historyWatcher = watch(
				dirname(this.options.suitesDir),
				{ recursive: true },
				(_event, file) => {
					const path = file?.toString() ?? "";
					const executionId = path.match(EXECUTION_FILE)?.[2];
					if (executionId) {
						this.scheduleHistoryBroadcast();
						this.scheduleExecutionBroadcast(executionId);
					}
					if (DISCOVERY_FILE.test(path)) this.scheduleCatalogRefresh();
				},
			);
		} catch {
			this.historyWatcher = undefined;
		}
	}
	private scheduleHistoryBroadcast(): void {
		if (this.historyRefresh) clearTimeout(this.historyRefresh);
		this.historyRefresh = setTimeout(() => {
			this.historyRefresh = undefined;
			void this.broadcastHistory();
		}, 100);
	}
	private scheduleCatalogRefresh(): void {
		if (!this.options.refreshTestCatalog || this.catalogRefresh) return;
		this.catalogRefresh = setTimeout(() => {
			this.catalogRefresh = undefined;
			void this.refreshCatalog();
		}, 100);
	}
	private async refreshCatalog(): Promise<void> {
		if (!this.options.refreshTestCatalog) return;
		const next = await this.options.refreshTestCatalog();
		if (next.fingerprint === this.testCatalog.fingerprint) return;
		this.testCatalog = next;
		this.broadcast({ type: "catalog.snapshot", catalog: next });
	}
	private async broadcastHistory(): Promise<void> {
		const root = executionHistoryRoot(this.options.suitesDir);
		await recoverExecutionHistory(root);
		this.broadcast({ type: "executions.snapshot", executions: await listExecutionHistory(root) });
	}
	private startExecutionPolling(): void {
		if (this.executionPoll) return;
		const poll = () => void this.pollExecutionHistory();
		this.executionPoll = setInterval(poll, this.options.executionPollMs ?? 250);
		poll();
	}
	private stopExecutionPolling(): void {
		if (this.subscribers.size > 0 || !this.executionPoll) return;
		clearInterval(this.executionPoll);
		this.executionPoll = undefined;
		this.polledRunningExecutions.clear();
	}
	private async pollExecutionHistory(): Promise<void> {
		if (this.pollingExecutions || this.closed) return;
		this.pollingExecutions = true;
		try {
			const root = executionHistoryRoot(this.options.suitesDir);
			await recoverExecutionHistory(root);
			const executions = await listExecutionHistory(root);
			this.broadcast({ type: "executions.snapshot", executions });
			const running = new Set(
				executions.filter((execution) => execution.status === "running").map(({ id }) => id),
			);
			const changed = new Set([...running, ...this.polledRunningExecutions]);
			this.polledRunningExecutions = running;
			await Promise.all([...changed].map((id) => this.broadcastExecution(id)));
		} finally {
			this.pollingExecutions = false;
		}
	}
	private scheduleExecutionBroadcast(executionId: string): void {
		const pending = this.executionRefreshes.get(executionId);
		if (pending) clearTimeout(pending);
		this.executionRefreshes.set(
			executionId,
			setTimeout(() => {
				this.executionRefreshes.delete(executionId);
				void this.broadcastExecution(executionId);
			}, 50),
		);
	}
	private async broadcastExecution(executionId: string): Promise<void> {
		const execution = await this.viewerExecution(executionId);
		if (execution) this.broadcast({ type: "execution.snapshot", execution });
	}
	private async viewerExecution(id: string) {
		const root = join(executionHistoryRoot(this.options.suitesDir), id);
		const execution = await readExecutionDetail(root);
		return execution ? { ...execution, cancellable: this.executions.has(id) } : undefined;
	}
	private broadcast(message: object): void {
		const data = JSON.stringify(message);
		for (const client of this.subscribers)
			if (client.readyState === WEBSOCKET_OPEN) client.send(data);
	}
	private handleUpgrade(
		request: IncomingMessage,
		socket: import("node:stream").Duplex,
		head: Buffer,
	): void {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== "/api/live" || url.searchParams.get("token") !== this.socketToken) {
			socket.destroy();
			return;
		}
		this.sockets.handleUpgrade(request, socket, head, (client) => {
			const timeout = setTimeout(() => client.close(1008, "Handshake required"), 5_000);
			client.once("message", (raw) => {
				clearTimeout(timeout);
				this.acceptClient(client, raw.toString());
			});
		});
	}
	private acceptClient(client: import("ws").WebSocket, raw: string): void {
		try {
			const hello = parseViewerClientMessage(JSON.parse(raw));
			if (hello.protocol !== VIEWER_PROTOCOL_VERSION) {
				client.send(
					JSON.stringify({
						type: "error",
						code: "incompatible_protocol",
						message: "Protocol mismatch",
					}),
				);
				client.close(1002);
				return;
			}
			this.subscribers.add(client);
			this.startExecutionPolling();
			client.once("close", () => {
				this.subscribers.delete(client);
				this.stopExecutionPolling();
			});
			client.send(JSON.stringify({ type: "ready", protocol: VIEWER_PROTOCOL_VERSION }));
			if (hello.subscriptions.includes("catalog"))
				this.broadcast({ type: "catalog.snapshot", catalog: this.testCatalog });
			if (hello.subscriptions.includes("executions")) void this.broadcastHistory();
		} catch {
			client.send(
				JSON.stringify({ type: "error", code: "invalid_message", message: "Invalid handshake" }),
			);
			client.close(1008);
		}
	}
	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (request.method === "GET" && this.handleGet(path, response)) return;
		if (request.method === "POST" && (await this.handlePost(path, request, response))) return;
		response.writeHead(404);
		response.end();
	}
	private handleGet(path: string, response: ServerResponse): boolean {
		if (path === "/" || path === "/index.html" || VIEWER_ROUTE.test(path))
			return this.render(response);
		if (path === "/api/test-catalog") return writeJson(response, 200, this.testCatalog);
		if (path === "/api/executions") {
			void this.writeHistory(response);
			return true;
		}
		const executionId = path.match(EXECUTION_ROUTE)?.[1];
		if (!executionId) return false;
		void this.writeExecution(response, executionId);
		return true;
	}
	private async handlePost(
		path: string,
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<boolean> {
		if (path === "/api/executions") {
			await this.startExecution(request, response);
			return true;
		}
		const executionId = path.match(EXECUTION_CANCEL_ROUTE)?.[1];
		if (!executionId) return false;
		writeJson(response, this.cancelExecution(executionId) ? 202 : 404, { cancelled: true });
		return true;
	}
	private render(response: ServerResponse): true {
		const bootstrap: ViewerBootstrap = {
			capabilities: {
				socket: { path: "/api/live", token: this.socketToken, protocol: VIEWER_PROTOCOL_VERSION },
			},
		};
		write(response, {
			status: 200,
			contentType: "text/html; charset=utf-8",
			body: renderViewerPage(bootstrap, { baseCss: viewerCss() }),
		});
		return true;
	}
	private async writeHistory(response: ServerResponse): Promise<void> {
		const root = executionHistoryRoot(this.options.suitesDir);
		await recoverExecutionHistory(root);
		writeJson(response, 200, { executions: await listExecutionHistory(root) });
	}
	private async writeExecution(response: ServerResponse, id: string): Promise<void> {
		const execution = await this.viewerExecution(id);
		if (!execution) {
			writeJson(response, 404, { error: "Execution not found" });
			return;
		}
		writeJson(response, 200, { execution });
	}
	private async startExecution(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const input = await readJson(request);
			if (!isExecutionRequest(input))
				throw new Error("Choose a discovered test or the whole suite");
			const args = executionArguments(input, this.testCatalog, this.options.suitesDir);
			const start = this.options.startExecution ?? startRecordedExecution;
			const execution = await start({ config: this.options.suitesDir, args });
			this.executions.set(execution.id, execution);
			void execution.completed.finally(() => this.executions.delete(execution.id));
			writeJson(response, 202, { executionId: execution.id });
		} catch (error) {
			writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
		}
	}
	private cancelExecution(id: string): boolean {
		const execution = this.executions.get(id);
		if (!execution) return false;
		execution.cancel();
		return true;
	}
	private bumpIdle(): void {
		if (!this.options.idleMs) return;
		if (this.idle) clearTimeout(this.idle);
		this.idle = setTimeout(() => void this.close(), this.options.idleMs);
	}
	async listen(): Promise<ViewerServerHandle> {
		await new Promise<void>((resolveListen, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.options.port ?? 0, VIEWER_HOST, resolveListen);
		});
		const address = this.server.address();
		if (!address || typeof address === "string") throw new Error("viewer has no port");
		this.bumpIdle();
		return { url: `http://${VIEWER_HOST}:${address.port}/`, close: this.close };
	}
	close = (): Promise<void> => {
		if (this.closed) return Promise.resolve();
		this.closed = true;
		this.stopResources();
		return new Promise((resolveClose, reject) => {
			this.server.close((error) => {
				if (error) return reject(error);
				Promise.resolve(this.options.onClose?.()).then(resolveClose, reject);
			});
		});
	};
	private stopResources(): void {
		if (this.idle) clearTimeout(this.idle);
		if (this.historyRefresh) clearTimeout(this.historyRefresh);
		if (this.executionPoll) clearInterval(this.executionPoll);
		if (this.catalogRefresh) clearTimeout(this.catalogRefresh);
		for (const refresh of this.executionRefreshes.values()) clearTimeout(refresh);
		this.executionRefreshes.clear();
		this.historyWatcher?.close();
		for (const execution of this.executions.values()) execution.cancel();
		for (const client of this.sockets.clients) client.close();
		this.sockets.close();
	}
}
export async function listenViewer(options: ListenViewerOptions): Promise<ViewerServerHandle> {
	return new ViewerServer(options).listen();
}
type ExecutionScope = { testId: string } | { testIds: string[] } | { all: true };
type ExecutionRequest = ExecutionScope & { workers?: number };
function isExecutionRequest(value: unknown): value is ExecutionRequest {
	if (typeof value !== "object" || value === null) return false;
	const input = value as { testId?: unknown; testIds?: unknown; all?: unknown; workers?: unknown };
	const hasScope =
		typeof input.testId === "string" ||
		(Array.isArray(input.testIds) &&
			input.testIds.length > 0 &&
			input.testIds.every((id) => typeof id === "string")) ||
		input.all === true;
	const hasValidWorkers =
		input.workers === undefined ||
		(Number.isInteger(input.workers) && Number(input.workers) >= 1 && Number(input.workers) <= 32);
	return hasScope && hasValidWorkers;
}
function executionArguments(
	input: ExecutionRequest,
	catalog: TestCatalog,
	suitesDir: string,
): string[] {
	const workers = String(input.workers ?? 1);
	if ("all" in input) return ["--workers", workers];
	if ("testIds" in input)
		return [...groupExecutionArguments(input.testIds, catalog, suitesDir), "--workers", workers];
	const test = catalog.tests.find((entry) => entry.id === input.testId);
	if (!test) throw new Error("Test is no longer in the discovered catalog");
	const args = [
		resolve(dirname(suitesDir), test.file),
		"--grep",
		`${escapeTitle(test.title.join(" "))}$`,
	];
	if (test.project !== "default") args.push("--project", test.project);
	return [...args, "--workers", workers];
}
function groupExecutionArguments(
	testIds: string[],
	catalog: TestCatalog,
	suitesDir: string,
): string[] {
	const selected = [...new Set(testIds)].map((id) => catalog.tests.find((test) => test.id === id));
	if (selected.some((test) => !test))
		throw new Error("A suite test is no longer in the discovered catalog");
	const tests = selected.filter((test) => test !== undefined);
	const files = [...new Set(tests.map((test) => resolve(dirname(suitesDir), test.file)))];
	const titles = tests.map((test) => escapeTitle(test.title.join(" ")));
	return [...files, "--grep", `(?:${titles.join("|")})$`];
}
function escapeTitle(title: string): string {
	return title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 1_000_000) throw new Error("Request body is too large");
		chunks.push(buffer);
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	return raw ? (JSON.parse(raw) as unknown) : {};
}
function writeJson(response: ServerResponse, status: number, body: unknown): true {
	write(response, {
		status,
		contentType: "application/json; charset=utf-8",
		body: `${JSON.stringify(body)}\n`,
	});
	return true;
}
function write(response: ServerResponse, data: ViewerResponse): void {
	response.writeHead(data.status, {
		"content-type": data.contentType,
		"cache-control": "no-store",
	});
	response.end(data.body);
}
interface ViewerResponse {
	status: number;
	contentType: string;
	body: string;
}
