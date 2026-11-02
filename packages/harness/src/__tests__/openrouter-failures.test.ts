import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentSession, openrouter } from "../../dist/index.js";

const SSE = { "Content-Type": "text/event-stream" };
const TEXT = 'data: {"choices":[{"delta":{"content":"partial reply"}}]}\n\n';
const STOP = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
const DONE = "data: [DONE]\n\n";

function sendJson(response: ServerResponse, status: number, message: string) {
	response.writeHead(status, { "Content-Type": "application/json" });
	response.end(JSON.stringify({ error: { code: status, message } }));
}
function sse(body: string) {
	return (response: ServerResponse) => {
		response.writeHead(200, SSE);
		response.end(body);
	};
}
const ROUTES: Record<string, (response: ServerResponse) => void> = {
	complete: sse(`${TEXT}${STOP}${DONE}`),
	"done-without-newline": sse(`${TEXT}data: [DONE]`),
	"noisy-complete": sse(`: OPENROUTER PROCESSING\n\ndata: {broken\n\n${TEXT}${STOP}${DONE}`),
	"silent-model": sse(`${STOP}${DONE}`),
	empty: sse(""),
	html: (response) => {
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end("<html>maintenance</html>");
	},
	truncated: sse(TEXT),
	"done-only": sse(DONE),
	"cut-connection": (response) => {
		response.writeHead(200, SSE);
		response.write(TEXT);
		setTimeout(() => response.destroy(), 20);
	},
	midstream: sse(
		`${TEXT}data: {"error":{"code":"server_error","message":"provider died"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n${DONE}`,
	),
	"midstream-auth": sse(`data: {"error":{"code":401,"message":"key revoked"}}\n\n${DONE}`),
	"finish-error": sse(`${TEXT}data: {"choices":[{"delta":{},"finish_reason":"error"}]}\n\n${DONE}`),
	hang: (response) => {
		response.writeHead(200, SSE);
		response.write(TEXT);
	},
	unauthorized: (response) => sendJson(response, 401, "No auth credentials found"),
	forbidden: (response) => sendJson(response, 403, "Key limit reached"),
	credits: (response) => sendJson(response, 402, "Insufficient credits"),
	"rate-limited": (response) => sendJson(response, 429, "Rate limited"),
	"server-error": (response) => sendJson(response, 500, "Internal"),
	overloaded: (response) => sendJson(response, 529, "Overloaded"),
	"bad-model": (response) => sendJson(response, 400, "Not a valid model"),
	"leaky-error": (response) => sendJson(response, 500, `upstream token=${leakedSecret()}`),
};
function leakedSecret() {
	return ["hunter", "2secret"].join("");
}

let server: Server;
let origin = "";
let directory = "";
const previousKey = process.env.OPENROUTER_API_KEY;

function run(route: string, timeoutMs?: number, baseUrl = `${origin}/${route}`) {
	const controller = new AbortController();
	const events: unknown[] = [];
	return createAgentSession({
		agent: openrouter({ model: "test/model", baseUrl, timeoutMs }),
		workspace: directory,
		signal: controller.signal,
	})
		.then(async (session) => {
			try {
				const trace = await session.run("hi", (event) => events.push(event));
				return { trace, failure: undefined as unknown, events };
			} catch (failure) {
				return { trace: undefined, failure, events };
			} finally {
				await session.close();
			}
		})
		.finally(() => controller.abort());
}

beforeAll(async () => {
	process.env.OPENROUTER_API_KEY = ["fake", "openrouter", "key"].join("-");
	directory = await realpath(await mkdtemp(join(tmpdir(), "openrouter-failures-")));
	server = createServer((request, response) => {
		const route = (request.url ?? "").split("/")[1] ?? "";
		const handler = ROUTES[route];
		if (handler) handler(response);
		else sendJson(response, 404, "no such route");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
	else process.env.OPENROUTER_API_KEY = previousKey;
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
});

describe("a complete OpenRouter stream", () => {
	it("completes on [DONE] after a reply", async () => {
		const { trace, failure } = await run("complete");
		expect(failure).toBeUndefined();
		expect(trace?.messages.at(-1)?.content).toBe("partial reply");
	});
	it("reads a [DONE] with no trailing newline", async () => {
		const { failure } = await run("done-without-newline");
		expect(failure).toBeUndefined();
	});
	it("ignores SSE comments and counts a line it could not parse", async () => {
		const { trace, failure } = await run("noisy-complete");
		expect(failure).toBeUndefined();
		expect(trace?.artifacts.droppedOutputLines).toBe("1");
	});
	it("a model that finished without text did not answer", async () => {
		const { failure } = await run("silent-model");
		expect(failure).toMatchObject({ code: "capture_incomplete" });
	});
});

const FAILURES: Array<[string, string]> = [
	["empty", "capture_incomplete"],
	["html", "capture_incomplete"],
	["truncated", "capture_incomplete"],
	["done-only", "capture_incomplete"],
	["cut-connection", "capture_incomplete"],
	["midstream", "provider_unavailable"],
	["midstream-auth", "auth"],
	["finish-error", "provider_unavailable"],
	["unauthorized", "auth"],
	["forbidden", "auth"],
	["credits", "provider_unavailable"],
	["rate-limited", "provider_unavailable"],
	["server-error", "provider_unavailable"],
	["overloaded", "provider_unavailable"],
	["bad-model", "host_exit"],
];
describe("OpenRouter failures are typed", () => {
	for (const [route, code] of FAILURES) {
		it(`${route} is ${code}`, async () => {
			const { failure } = await run(route);
			expect(failure).toMatchObject({ kind: "infrastructure", code });
		});
	}
	it("an unreachable provider is provider_unavailable", async () => {
		const { failure } = await run("", undefined, "http://127.0.0.1:9/nothing-listens");
		expect(failure).toMatchObject({ kind: "infrastructure", code: "provider_unavailable" });
	});
	it("a deadline is timeout and keeps the streamed text", async () => {
		const { failure, events } = await run("hang", 200);
		expect(failure).toMatchObject({ kind: "infrastructure", code: "timeout", timeoutMs: 200 });
		expect(JSON.stringify(events)).toContain("partial reply");
	});
	it("a failed stream keeps what it streamed as evidence", async () => {
		const { events } = await run("midstream");
		const traces = events.filter((event) => (event as { type: string }).type === "trace");
		expect(JSON.stringify(traces)).toContain("partial reply");
	});
	it("redacts secrets from the failure and its artifacts", async () => {
		const { failure, events } = await run("leaky-error");
		expect(String((failure as Error).message)).toContain("upstream");
		expect(String((failure as Error).message)).not.toContain(leakedSecret());
		expect(JSON.stringify(events)).not.toContain(leakedSecret());
	});
});
