import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { StartExecutionOptions } from "../sdk/execution-runner.js";
import {
	ExecutionStore,
	executionHistoryRoot,
	saveExecutionVerdict,
} from "../sdk/execution-store.js";
import type { VerdictResult } from "../sdk/verdict.js";
import { ViewerApi } from "../viewer/generated-api.js";
import { listenViewer } from "../viewer/server.js";
import { createTestCatalog } from "../viewer/test-catalog.js";

const SOCKET_TOKEN = /"socket":\{"path":"\/api\/live","token":"([^"]+)/;
const HTTP_PROTOCOL = /^http/;
const TRAILING_SLASH = /\/$/;
function fixtureCatalog() {
	return createTestCatalog("/workspace/agent-test.config.ts", [
		{
			id: "test-1",
			file: "/workspace/tests/smoke.spec.ts",
			title: "smoke › works",
			project: "default",
		},
	]);
}

it("viewer server › serves the direct catalog and restores execution routes", async () => {
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
	});
	try {
		const catalog = await fetch(new URL("/api/test-catalog", handle.url));
		expect(await catalog.text()).toContain("smoke.spec.ts");
		const page = await fetch(
			new URL("/executions/a1b2c3d4-e5f6-7890-a1b2-c3d4e5f67890", handle.url),
		);
		expect(page.status).toBe(200);
	} finally {
		await handle.close();
	}
});

it("viewer server › reads durable CLI execution history", async () => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-history-"));
	const config = join(directory, "agent-test.config.ts");
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), "e1ec-1"),
		id: "e1ec-1",
		config,
	});
	await store.record({ type: "attempt.started", level: "info", attemptId: "attempt-1" });
	await store.finish("passed");
	const handle = await listenViewer({
		suitesDir: config,
		testCatalog: fixtureCatalog(),
	});
	try {
		expect(await (await fetch(new URL("/api/executions", handle.url))).text()).toContain("e1ec-1");
		expect(await (await fetch(new URL("/api/executions/e1ec-1", handle.url))).text()).toContain(
			'"attempts"',
		);
	} finally {
		await handle.close();
		await rm(directory, { recursive: true, force: true });
	}
});

it("viewer server › starts the whole suite as one recorded execution", async () => {
	let received: StartExecutionOptions | undefined;
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
		startExecution: async (options) => {
			received = options;
			return { id: "feed-face", cancel: () => undefined, completed: Promise.resolve(0) };
		},
	});
	try {
		const response = await fetch(new URL("/api/executions", handle.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ all: true, workers: 4 }),
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ executionId: "feed-face" });
		expect(received).toEqual({
			config: "/workspace/agent-test.config.ts",
			args: ["--workers", "4"],
		});
		const invalid = await fetch(new URL("/api/executions", handle.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ all: true, workers: 33 }),
		});
		expect(invalid.status).toBe(400);
	} finally {
		await handle.close();
	}
});

it("viewer server › starts one catalog group as one recorded execution", async () => {
	let received: StartExecutionOptions | undefined;
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
		startExecution: async (options) => {
			received = options;
			return { id: "cafe-babe", cancel: () => undefined, completed: Promise.resolve(0) };
		},
	});
	try {
		const response = await fetch(new URL("/api/executions", handle.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ testIds: ["test-1"] }),
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ executionId: "cafe-babe" });
		expect(received).toEqual({
			config: "/workspace/agent-test.config.ts",
			args: ["/workspace/tests/smoke.spec.ts", "--grep", "(?:smoke works)$", "--workers", "1"],
		});
	} finally {
		await handle.close();
	}
});

it("viewer server › accepts the versioned WebSocket handshake", async () => {
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
	});
	try {
		const token = (await (await fetch(handle.url)).text()).match(SOCKET_TOKEN)?.[1];
		if (!token) throw new Error("Viewer socket token is missing");
		const address = handle.url.replace(HTTP_PROTOCOL, "ws").replace(TRAILING_SLASH, "");
		const messages = await readSocketMessages(`${address}/api/live?token=${token}`);
		expect(messages).toContain('"type":"ready"');
		expect(messages).toContain('"type":"catalog.snapshot"');
	} finally {
		await handle.close();
	}
});

function readSocketMessages(url: string): Promise<string> {
	return new Promise((resolveMessages, reject) => {
		const socket = new WebSocket(url);
		const messages: string[] = [];
		socket.once("error", reject);
		socket.once("open", () =>
			socket.send(
				JSON.stringify({ type: "hello", protocol: 1, subscriptions: ["catalog", "executions"] }),
			),
		);
		socket.on("message", (raw) => {
			messages.push(raw.toString());
			if (messages.some((message) => message.includes('"type":"catalog.snapshot"'))) {
				socket.close();
				resolveMessages(messages.join("\n"));
			}
		});
	});
}

it("viewer server › serves only attachments the execution recorded", async () => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-attachments-"));
	const config = join(directory, "agent-test.config.ts");
	const steps = join(directory, "steps.jsonl");
	await writeFile(steps, '{"step":1}\n');
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), "a77a-1"),
		id: "a77a-1",
		config,
	});
	await store.record({ type: "attempt.started", level: "info", attemptId: "attempt-1" });
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: "attempt-1",
		data: {
			status: "passed",
			attachments: [{ name: "steps", contentType: "application/x-ndjson", path: steps }],
		},
	});
	await store.finish("passed");
	const handle = await listenViewer({ suitesDir: config, testCatalog: fixtureCatalog() });
	try {
		const detail = await (await fetch(new URL("/api/executions/a77a-1", handle.url))).text();
		expect(detail).not.toContain(steps);
		const url = "/api/executions/a77a-1/attempts/0/attachments/0";
		expect(detail).toContain(url);
		const file = await fetch(new URL(url, handle.url));
		expect(file.headers.get("content-type")).toBe("application/x-ndjson");
		expect(await file.text()).toBe('{"step":1}\n');
		const missing = await fetch(
			new URL("/api/executions/a77a-1/attempts/0/attachments/1", handle.url),
		);
		expect(missing.status).toBe(404);
	} finally {
		await handle.close();
		await rm(directory, { recursive: true, force: true });
	}
});

type RawResponse = { status: number; body: string; headers: Record<string, unknown> };

/** Sends the exact headers a browser or attacker would; `fetch` refuses to set some of them. */
function rawRequest(
	url: string,
	input: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
	const { hostname, port } = new URL(url);
	return new Promise((resolveResponse, reject) => {
		const request = httpRequest(
			{
				hostname,
				port,
				path: input.path ?? "/",
				method: input.method ?? "GET",
				headers: input.headers,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () =>
					resolveResponse({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
						headers: response.headers,
					}),
				);
			},
		);
		request.on("error", reject);
		request.end(input.body);
	});
}

async function withStartCounter(run: (url: string, started: () => number) => Promise<void>) {
	let starts = 0;
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
		startExecution: async () => {
			starts++;
			return { id: "feed-face", cancel: () => undefined, completed: Promise.resolve(0) };
		},
	});
	try {
		await run(handle.url, () => starts);
	} finally {
		await handle.close();
	}
}

const START_ALL = { method: "POST", path: "/api/executions", body: '{"all":true}' };
const JSON_BODY = { "content-type": "application/json" };

it("viewer server › refuses a cross-site request to start a run", async () => {
	await withStartCounter(async (url, started) => {
		const refused = [
			{ ...JSON_BODY, origin: "https://evil.example" },
			{ ...JSON_BODY, origin: "null" },
			{ ...JSON_BODY, origin: `http://127.0.0.1:${Number(new URL(url).port) + 1}` },
			{ ...JSON_BODY, "sec-fetch-site": "cross-site" },
		];
		for (const headers of refused)
			expect((await rawRequest(url, { ...START_ALL, headers })).status).toBe(403);
		expect(started()).toBe(0);
	});
});

it("viewer server › refuses a form a cross-site page could submit without preflight", async () => {
	await withStartCounter(async (url, started) => {
		const contentTypes = ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"];
		for (const type of contentTypes) {
			const response = await rawRequest(url, { ...START_ALL, headers: { "content-type": type } });
			expect(response.status).toBe(415);
		}
		expect((await rawRequest(url, START_ALL)).status).toBe(415);
		expect(started()).toBe(0);
	});
});

it("viewer server › accepts a same-origin start at the bound port", async () => {
	await withStartCounter(async (url, started) => {
		const { host, origin } = new URL(url);
		const headers = { ...JSON_BODY, host, origin, "sec-fetch-site": "same-origin" };
		expect((await rawRequest(url, { ...START_ALL, headers })).status).toBe(202);
		expect(started()).toBe(1);
		const local = `localhost:${new URL(url).port}`;
		const asLocalhost = { ...JSON_BODY, host: local, origin: `http://${local}` };
		expect((await rawRequest(url, { ...START_ALL, headers: asLocalhost })).status).toBe(202);
		expect(started()).toBe(2);
	});
});

it("viewer server › an Origin that names another local address is not same-origin", async () => {
	await withStartCounter(async (url) => {
		const { host, port } = new URL(url);
		const headers = { ...JSON_BODY, host, origin: `http://localhost:${port}` };
		expect((await rawRequest(url, { ...START_ALL, headers })).status).toBe(403);
	});
});

it("viewer server › refuses a rebound Host on every route", async () => {
	await withStartCounter(async (url, started) => {
		const { port } = new URL(url);
		const refused = [
			"evil.example",
			`evil.example:${port}`,
			`127.0.0.1:${Number(port) + 1}`,
			"127.0.0.1",
		];
		for (const host of refused) {
			expect((await rawRequest(url, { headers: { host } })).status).toBe(403);
			const page = await rawRequest(url, { path: "/api/executions", headers: { host } });
			expect(page.status).toBe(403);
			const start = { ...START_ALL, headers: { ...JSON_BODY, host, origin: `http://${host}` } };
			expect((await rawRequest(url, start)).status).toBe(403);
		}
		expect(started()).toBe(0);
		for (const host of [
			`127.0.0.1:${port}`,
			`localhost:${port}`,
			`[::1]:${port}`,
			`LOCALHOST:${port}`,
		])
			expect((await rawRequest(url, { headers: { host } })).status).toBe(200);
	});
});

it("viewer server › guards the cancel route the same way", async () => {
	await withStartCounter(async (url) => {
		const path = "/api/executions/feed-face/cancel";
		const cross = await rawRequest(url, {
			method: "POST",
			path,
			headers: { ...JSON_BODY, origin: "https://evil.example" },
		});
		expect(cross.status).toBe(403);
		const form = await rawRequest(url, { method: "POST", path });
		expect(form.status).toBe(415);
		const allowed = await rawRequest(url, { method: "POST", path, headers: JSON_BODY });
		expect(allowed.status).toBe(404);
	});
});

it("viewer api › the browser's cancel request passes the viewer's own guard", async () => {
	let init: RequestInit | undefined;
	const api = new ViewerApi(async (_input, sent) => {
		init = sent;
		return new Response("{}");
	});
	await api.cancelExecution("feed-face");
	expect(init?.method).toBe("POST");
	expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
});

it("viewer server › refuses a live socket from another site or host", async () => {
	const handle = await listenViewer({
		suitesDir: "/workspace/agent-test.config.ts",
		testCatalog: fixtureCatalog(),
	});
	try {
		const token = (await (await fetch(handle.url)).text()).match(SOCKET_TOKEN)?.[1];
		const path = `/api/live?token=${token}`;
		const { host, origin } = new URL(handle.url);
		const opens = (headers: Record<string, string>) => socketOpens(handle.url, { path, headers });
		expect(await opens({ host, origin: "https://evil.example" })).toBe(false);
		expect(await opens({ host: "evil.example" })).toBe(false);
		expect(await opens({ host, origin })).toBe(true);
		expect(await opens({ host })).toBe(true);
	} finally {
		await handle.close();
	}
});

/** A raw upgrade, because a socket client will not send the Origin an attacker's page would. */
function socketOpens(
	url: string,
	{ path, headers }: { path: string; headers: Record<string, string> },
): Promise<boolean> {
	const lines = Object.entries({
		...headers,
		connection: "Upgrade",
		upgrade: "websocket",
		"sec-websocket-version": "13",
		"sec-websocket-key": Buffer.from("the sample nonce").toString("base64"),
	}).map(([name, value]) => `${name}: ${value}`);
	const { hostname, port } = new URL(url);
	return new Promise((resolveOpen) => {
		const socket = connect(Number(port), hostname, () =>
			socket.write(`GET ${path} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`),
		);
		socket.once("data", (data) => {
			resolveOpen(data.toString().startsWith("HTTP/1.1 101"));
			socket.destroy();
		});
		socket.once("close", () => resolveOpen(false));
		socket.once("error", () => resolveOpen(false));
	});
}

async function attachmentFixture(files: { name: string; contentType: string; content: string }[]) {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-unsafe-"));
	const config = join(directory, "agent-test.config.ts");
	const attachments = await Promise.all(
		files.map(async ({ name, contentType, content }, index) => {
			const path = join(directory, `file-${index}`);
			await writeFile(path, content);
			return { name, contentType, path };
		}),
	);
	const store = await ExecutionStore.create({
		root: join(executionHistoryRoot(config), "a77a-2"),
		id: "a77a-2",
		config,
	});
	await store.record({ type: "attempt.started", level: "info", attemptId: "attempt-1" });
	await store.record({
		type: "attempt.finished",
		level: "info",
		attemptId: "attempt-1",
		data: { status: "passed", attachments },
	});
	await store.finish("passed");
	return { directory, config };
}

it("viewer server › downloads active attachments in a sandbox and shows raster images", async () => {
	const script = "<script>window.ran = true</script>";
	const active = [
		{ name: "page", contentType: "text/html", content: script },
		{ name: "picture", contentType: "image/svg+xml", content: `<svg>${script}</svg>` },
		{ name: "shouty", contentType: "TEXT/HTML; charset=utf-8", content: script },
		{ name: "unusual", contentType: "application/xhtml+xml", content: script },
		{ name: "../../sneaky\r\nX-Evil: 1", contentType: "text/plain", content: "text" },
	];
	const images = ["png", "jpeg", "gif", "webp"].map((kind) => ({
		name: kind,
		contentType: `image/${kind}`,
		content: "bytes",
	}));
	const fixture = await attachmentFixture([...active, ...images]);
	const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
	try {
		const file = (index: number) =>
			rawRequest(handle.url, { path: `/api/executions/a77a-2/attempts/0/attachments/${index}` });
		for (const index of active.keys()) {
			const { headers, status } = await file(index);
			expect(status).toBe(200);
			expect(String(headers["content-disposition"])).toStartWith("attachment");
			expect(String(headers["content-disposition"])).not.toContain("/");
			expect(headers["x-evil"]).toBeUndefined();
			expect(headers["x-content-type-options"]).toBe("nosniff");
			expect(headers["content-security-policy"]).toBe("sandbox");
		}
		for (const [offset, { contentType }] of images.entries()) {
			const { headers } = await file(active.length + offset);
			expect(headers["content-type"]).toBe(contentType);
			expect(String(headers["content-disposition"] ?? "inline")).toBe("inline");
			expect(headers["x-content-type-options"]).toBe("nosniff");
			expect(headers["content-security-policy"]).toBe("sandbox");
		}
	} finally {
		await handle.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

it("viewer server › an attachment content type that is not a valid header does not stop the server", async () => {
	const fixture = await attachmentFixture([
		{ name: "bad", contentType: "text/plain\r\nX-Evil: 1", content: "text" },
	]);
	const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
	try {
		const { headers, status } = await rawRequest(handle.url, {
			path: "/api/executions/a77a-2/attempts/0/attachments/0",
		});
		expect(status).toBe(200);
		expect(headers["content-type"]).toBe("application/octet-stream");
		expect(headers["x-evil"]).toBeUndefined();
	} finally {
		await handle.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

async function storedRuns(files: Record<string, string>) {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-corrupt-"));
	const config = join(directory, "agent-test.config.ts");
	for (const [id, content] of Object.entries(files)) {
		const root = join(executionHistoryRoot(config), id);
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "execution.json"), content);
	}
	return { directory, config };
}

async function readHistory(url: string) {
	const response = await fetch(new URL("/api/executions", url));
	if (!response.ok) throw new Error(`History answered ${response.status}`);
	const { executions } = (await response.json()) as {
		executions: { id: string; status: string; testIds: unknown; verdictUnreadable?: boolean }[];
	};
	return new Map(executions.map((execution) => [execution.id, execution]));
}

const GOOD_RUN = JSON.stringify({
	version: 1,
	id: "aa",
	config: "c",
	startedAt: "2026-01-01T00:00:00.000Z",
	finishedAt: "2026-01-01T00:00:01.000Z",
	status: "passed",
	testIds: ["test-1"],
	testStatuses: { "test-1": "passed" },
});

it("viewer server › lists corrupt records as unknown beside the runs it can read", async () => {
	const fixture = await storedRuns({
		aa: GOOD_RUN,
		bb: "{ not json",
		cc: "null",
		dd: "[]",
		ee: '{"id":"ee"}',
		ff: '{"id":"ff","startedAt":7,"status":"maybe","testIds":5,"testStatuses":"x"}',
	});
	const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
	try {
		const history = await readHistory(handle.url);
		expect(history.get("aa")?.status).toBe("passed");
		for (const id of ["bb", "cc", "dd", "ee", "ff"]) {
			expect(history.get(id)?.status).toBe("unknown");
			expect(history.get(id)?.testIds).toEqual([]);
		}
		const detail = await fetch(new URL("/api/executions/ff", handle.url));
		expect(detail.status).toBe(404);
		const missing = await fetch(new URL("/api/executions/bb", handle.url));
		expect(missing.status).toBe(404);
		const page = await fetch(new URL("/executions/bb", handle.url));
		expect(page.status).toBe(200);
	} finally {
		await handle.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

it("viewer server › one record with no start time does not hide the others", async () => {
	const fixture = await storedRuns({
		aa: GOOD_RUN,
		bb: JSON.stringify({ ...JSON.parse(GOOD_RUN), id: "bb", startedAt: undefined }),
	});
	const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
	try {
		const history = await readHistory(handle.url);
		expect(history.get("aa")?.status).toBe("passed");
		expect(history.has("bb")).toBe(true);
	} finally {
		await handle.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

it("viewer server › a malformed stored verdict reads as unreadable, not as the recorded pass", async () => {
	for (const verdict of ["garbage", { verdict: "passed" }, { verdict: "invented", tests: {} }]) {
		const fixture = await storedRuns({ aa: JSON.stringify({ ...JSON.parse(GOOD_RUN), verdict }) });
		const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
		try {
			const run = (await readHistory(handle.url)).get("aa");
			expect(run?.verdictUnreadable).toBe(true);
			expect((run as { verdict?: unknown }).verdict).toBeUndefined();
		} finally {
			await handle.close();
			await rm(fixture.directory, { recursive: true, force: true });
		}
	}
});

it("viewer server › a journal with lines of the wrong shape answers, and the server lives", async () => {
	const fixture = await storedRuns({ aa: GOOD_RUN });
	const journal = join(executionHistoryRoot(fixture.config), "aa", "events.ndjson");
	await writeFile(journal, 'null\n5\n{"attemptId":"attempt-1"}\n');
	const handle = await listenViewer({ suitesDir: fixture.config, testCatalog: fixtureCatalog() });
	try {
		expect((await fetch(new URL("/api/executions/aa", handle.url))).status).toBe(200);
		expect((await fetch(new URL("/api/executions", handle.url))).status).toBe(200);
	} finally {
		await handle.close();
		await rm(fixture.directory, { recursive: true, force: true });
	}
});

it("viewer server › maps each repeat of a sampled test to its stored claim", async () => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-viewer-claims-"));
	const config = join(directory, "agent-test.config.ts");
	const root = join(executionHistoryRoot(config), "cc");
	const store = await ExecutionStore.create({ root, id: "cc", config });
	await store.setTests(["repeat-1", "repeat-2"]);
	const title = ["", "default", "a.spec.ts", "group", "works"];
	for (const testId of ["repeat-1", "repeat-2"]) {
		const attemptId = `attempt-${testId}`;
		const data = { testId, title, retry: 0, project: "default" };
		await store.record({ type: "attempt.started", level: "info", attemptId, data });
		await store.record({
			type: "attempt.finished",
			level: "info",
			attemptId,
			data: { status: "passed" },
		});
	}
	await store.finish("passed");
	const claim = "default › a.spec.ts › group › works";
	await saveExecutionVerdict(root, {
		verdict: "measured",
		exitCode: 0,
		tests: {},
		counts: { passed: 0, total: 0 },
		claims: [
			{ claim, arms: [], declared: false, decision: "measured", baseline: { status: "none" } },
		],
	} as VerdictResult);
	const handle = await listenViewer({ suitesDir: config, testCatalog: fixtureCatalog() });
	try {
		const { executions } = (await (await fetch(new URL("/api/executions", handle.url))).json()) as {
			executions: { testClaims?: Record<string, string> }[];
		};
		expect(executions[0]?.testClaims).toEqual({ "repeat-1": claim, "repeat-2": claim });
	} finally {
		await handle.close();
		await rm(directory, { recursive: true, force: true });
	}
});
