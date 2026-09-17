#!/usr/bin/env node
/**
 * Minimal stdio MCP server for agent-test.
 * Speaks MCP JSON-RPC as Content-Length frames or newline-delimited JSON.
 */
import { Buffer } from "node:buffer";

const CONTENT_LENGTH = /^Content-Length:\s*(\d+)/im;
const TRAILING_CR = /\r$/;
const CONTENT_LENGTH_HEADER = /^content-length:/i;

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "mcp-echo", version: "0.2.0" };
const LOOKUP_NOTES = {
	alpha: "agent-test-mcp-read-ok-4b8d",
};
const TASKS = {
	"TASK-104": {
		id: "TASK-104",
		title: "Ship the task list",
		owner: "Mina",
		due: "2026-09-24",
		status: "ready",
	},
};
const NOTE_URI = "note://alpha";

/** @type {Buffer} */
let buffer = Buffer.alloc(0);
/** @type {"ndjson" | "framed"} */
let replyMode = "ndjson";

function writeNdjson(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeFramed(message) {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}

function writeMessage(message) {
	if (replyMode === "framed") {
		writeFramed(message);
		return;
	}
	writeNdjson(message);
}

function toolsList() {
	return [
		{
			name: "echo",
			description: "Echo a text message back. Use this instead of Shell.",
			inputSchema: {
				type: "object",
				properties: {
					text: { type: "string", description: "Text to echo" },
				},
				required: ["text"],
			},
		},
		{
			name: "lookup",
			description: 'Return the canned note for a known id. Use id "alpha".',
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "Note id" },
				},
				required: ["id"],
			},
		},
		{
			name: "search_tasks",
			description: "Find task summaries. A summary can be out of date.",
			inputSchema: {
				type: "object",
				properties: { text: { type: "string", description: "Words to find" } },
				required: ["text"],
			},
		},
		{
			name: "get_task",
			description: "Get the current task record by its ID.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string", description: "Task ID" } },
				required: ["id"],
			},
		},
		{
			name: "task_index",
			description: "Get the one current task that matches a short question.",
			inputSchema: {
				type: "object",
				properties: { question: { type: "string", description: "Question about a task" } },
				required: ["question"],
			},
		},
	];
}

function toolText(name, args) {
	switch (name) {
		case "echo":
			return typeof args.text === "string" ? args.text : "";
		case "lookup":
			return LOOKUP_NOTES[typeof args.id === "string" ? args.id : ""] ?? "unknown id";
		case "search_tasks":
			return "TASK-104: Ship the task list. Summary due date: 2026-09-20.";
		case "get_task": {
			const task = TASKS[typeof args.id === "string" ? args.id : ""];
			return task ? JSON.stringify(task) : "unknown task";
		}
		case "task_index":
			return JSON.stringify(TASKS["TASK-104"]);
		default:
			return undefined;
	}
}

function handleToolsCall(id, params) {
	const text = toolText(params?.name, params?.arguments ?? {});
	if (text === undefined) {
		writeMessage({
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `Unknown tool: ${params?.name}` },
		});
		return;
	}
	writeMessage({
		jsonrpc: "2.0",
		id,
		result: { content: [{ type: "text", text }], isError: false },
	});
}

function handleResourceRead(id, params) {
	const uri = typeof params?.uri === "string" ? params.uri : "";
	if (uri !== NOTE_URI) {
		writeMessage({
			jsonrpc: "2.0",
			id,
			error: { code: -32602, message: `Unknown resource: ${uri}` },
		});
		return;
	}
	writeMessage({
		jsonrpc: "2.0",
		id,
		result: {
			contents: [
				{
					uri: NOTE_URI,
					mimeType: "text/plain",
					text: LOOKUP_NOTES.alpha,
				},
			],
		},
	});
}

function requestResult(method) {
	switch (method) {
		case "initialize":
			return {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {}, resources: {} },
				serverInfo: SERVER_INFO,
			};
		case "tools/list":
			return { tools: toolsList() };
		case "resources/list":
			return { resources: [{ uri: NOTE_URI, name: "alpha", mimeType: "text/plain" }] };
		case "ping":
			return {};
		default:
			return undefined;
	}
}

function handleRequest({ id, method, params }) {
	if (["notifications/initialized", "initialized", "notifications/cancelled"].includes(method))
		return;
	if (method === "tools/call") return handleToolsCall(id, params);
	if (method === "resources/read") return handleResourceRead(id, params);
	const result = requestResult(method);
	if (result !== undefined) return writeMessage({ jsonrpc: "2.0", id, result });
	if (id !== undefined)
		writeMessage({
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `Method not found: ${method}` },
		});
}

function consumeFramed() {
	const headerEnd = buffer.indexOf("\r\n\r\n");
	if (headerEnd === -1) {
		return false;
	}
	const header = buffer.subarray(0, headerEnd).toString("utf8");
	const match = header.match(CONTENT_LENGTH);
	if (!match) {
		return false;
	}
	const length = Number(match[1]);
	const start = headerEnd + 4;
	if (buffer.length < start + length) {
		return false;
	}
	const body = buffer.subarray(start, start + length).toString("utf8");
	buffer = buffer.subarray(start + length);
	replyMode = "framed";
	handleRequest(JSON.parse(body));
	return true;
}

function consumeNdjson() {
	const newline = buffer.indexOf(0x0a);
	if (newline === -1) {
		return false;
	}
	const line = buffer.subarray(0, newline).toString("utf8").replace(TRAILING_CR, "").trim();
	buffer = buffer.subarray(newline + 1);
	if (!line || CONTENT_LENGTH_HEADER.test(line)) {
		return true;
	}
	replyMode = "ndjson";
	handleRequest(JSON.parse(line));
	return true;
}

function consume() {
	while (true) {
		const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8").toLowerCase();
		const framed = prefix.startsWith("content-length");
		if (!consumeMessage(framed)) return;
	}
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	consume();
});

process.stdin.on("end", () => {
	process.exit(0);
});

function consumeMessage(framed) {
	try {
		return framed ? consumeFramed() : consumeNdjson();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`mcp-echo parse error: ${message}\n`);
		return !framed;
	}
}
