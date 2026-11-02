import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMcpCatalog, type McpCatalogEntry } from "../mcp-catalog.js";

type Rpc = { id?: number; method?: string; params?: { cursor?: string } };
type Answer = (message: Rpc) => string[];

const REPLY = (id: number | undefined, result: object) =>
	JSON.stringify({ jsonrpc: "2.0", id, result });
const TOOLS = (id: number | undefined, names: string[], nextCursor?: string) =>
	REPLY(id, { tools: names.map((name) => ({ name })), ...(nextCursor ? { nextCursor } : {}) });
const LIST_ERROR = (id: number | undefined) =>
	JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "no tools here" } });
const PAGED: Answer = ({ id, params }) =>
	params?.cursor === "two" ? [TOOLS(id, ["page2_tool"])] : [TOOLS(id, ["page1_tool"], "two")];
const ENDLESS: Answer = ({ id }) => [TOOLS(id, ["again"], "more")];

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A stdio server whose answers to `tools/list` come from `listAnswer`, written as JS source. */
async function stdioEntry(listAnswer: string): Promise<McpCatalogEntry> {
	const directory = await mkdtemp(join(tmpdir(), "catalog-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const script = join(directory, "server.mjs");
	await writeFile(
		script,
		`import { createInterface } from "node:readline";
const send = (message) => console.log(JSON.stringify(message));
const tools = (id, names, nextCursor) =>
	send({ id, result: { tools: names.map((name) => ({ name })), nextCursor } });
createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	if (message.method === "initialize") send({ id: message.id, result: {} });
	if (message.method === "tools/list") (${listAnswer})(message);
});`,
	);
	const [entry] = await listMcpCatalog(
		{ server: { type: "stdio", command: process.execPath, args: [script] } },
		{ cwd: directory },
	);
	if (!entry) throw new Error("Expected one catalog entry");
	return entry;
}

async function httpEntry(listAnswer: Answer, format: "json" | "sse" = "json") {
	const server: Server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			const message = JSON.parse(body) as Rpc;
			const lines = message.method === "tools/list" ? listAnswer(message) : [REPLY(message.id, {})];
			response.end(
				format === "sse" ? lines.map((line) => `data: ${line}\n`).join("\n") : lines.join("\n"),
			);
		});
	});
	await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
	cleanups.push(() => new Promise((closed) => server.close(() => closed())));
	const { port } = server.address() as AddressInfo;
	const [entry] = await listMcpCatalog(
		{ server: { type: "http", url: `http://127.0.0.1:${port}/mcp` } },
		{ cwd: tmpdir() },
	);
	if (!entry) throw new Error("Expected one catalog entry");
	return entry;
}

function listedNames(entry: McpCatalogEntry): string[] {
	if (entry.status !== "listed") throw new Error(`Expected a listing, got ${entry.error}`);
	return entry.tools.map(({ name }) => name);
}

describe("MCP catalog evidence over stdio", () => {
	it("stdio: follows every page of a paged listing", async () => {
		const entry = await stdioEntry(`({ id, params }) =>
			params.cursor === "two" ? tools(id, ["page2_tool"]) : tools(id, ["page1_tool"], "two")`);
		expect(listedNames(entry)).toEqual(["page1_tool", "page2_tool"]);
	});
	it("stdio: a JSON-RPC error is a failed listing, not an empty one", async () => {
		const entry = await stdioEntry(
			`({ id }) => send({ id, error: { code: -32601, message: "no tools here" } })`,
		);
		expect(entry).toMatchObject({ status: "failed" });
		expect(entry).toMatchObject({ error: expect.stringContaining("no tools here") });
	});
	it("stdio: a reply with no tool array is a failed listing", async () => {
		expect(await stdioEntry(`({ id }) => send({ id, result: {} })`)).toMatchObject({
			status: "failed",
		});
		expect(await stdioEntry(`({ id }) => send({ id, result: { tools: "x" } })`)).toMatchObject({
			status: "failed",
		});
	});
	it("stdio: a request from the server is not taken for the reply", async () => {
		const entry = await stdioEntry(`({ id }) => {
			send({ id, method: "roots/list" });
			tools(id, ["real_tool"]);
		}`);
		expect(listedNames(entry)).toEqual(["real_tool"]);
	});
	it("stdio: a listing that never ends fails instead of hanging", async () => {
		const entry = await stdioEntry(`({ id }) => tools(id, ["again"], "more")`);
		expect(entry.status).toBe("failed");
	}, 10_000);
	it("an empty listing is still a listing", async () => {
		expect(listedNames(await stdioEntry(`({ id }) => tools(id, [])`))).toEqual([]);
		expect(listedNames(await httpEntry(({ id }) => [TOOLS(id, [])]))).toEqual([]);
	});
});

describe("MCP catalog evidence over HTTP", () => {
	it("http: follows every page", async () => {
		expect(listedNames(await httpEntry(PAGED))).toEqual(["page1_tool", "page2_tool"]);
	});
	it("http: a JSON-RPC error or a garbage answer is a failed listing", async () => {
		const refused = await httpEntry(({ id }) => [LIST_ERROR(id)]);
		expect(refused).toMatchObject({ status: "failed" });
		expect(await httpEntry(() => ["<html>not rpc</html>"])).toMatchObject({ status: "failed" });
	});
	it("http: finds the reply behind a notification in an event stream", async () => {
		const entry = await httpEntry(
			({ id }) => [
				JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" }),
				TOOLS(id, ["real_tool"]),
			],
			"sse",
		);
		expect(listedNames(entry)).toEqual(["real_tool"]);
	});
	it("http: a stream that never carries the reply is a failed listing", async () => {
		const entry = await httpEntry(
			() => [JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })],
			"sse",
		);
		expect(entry.status).toBe("failed");
	});
	it("http: a listing that never ends fails instead of hanging", async () => {
		expect((await httpEntry(ENDLESS)).status).toBe("failed");
	}, 10_000);
});
