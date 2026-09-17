import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { StartExecutionOptions } from "../sdk/execution-runner.js";
import { ExecutionStore, executionHistoryRoot } from "../sdk/execution-store.js";
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
