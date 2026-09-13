#!/usr/bin/env node
/**
 * Minimal stdio MCP server for agent-test.
 * Speaks MCP JSON-RPC as Content-Length frames or newline-delimited JSON.
 */
import { Buffer } from "node:buffer";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "mcp-echo", version: "0.2.0" };
const LOOKUP_NOTES = {
	alpha: "agent-test-mcp-read-ok-4b8d",
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
	];
}

function handleToolsCall(id, params) {
	const name = params?.name;
	const args = params?.arguments ?? {};
	if (name === "echo") {
		const text = typeof args.text === "string" ? args.text : "";
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				content: [{ type: "text", text }],
				isError: false,
			},
		});
		return;
	}
	if (name === "lookup") {
		const key = typeof args.id === "string" ? args.id : "";
		const text = LOOKUP_NOTES[key] ?? "unknown id";
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				content: [{ type: "text", text }],
				isError: false,
			},
		});
		return;
	}
	writeMessage({
		jsonrpc: "2.0",
		id,
		error: { code: -32601, message: `Unknown tool: ${name}` },
	});
}

function handleRequest(message) {
	const { id, method, params } = message;
	if (method === "initialize") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {}, resources: {} },
				serverInfo: SERVER_INFO,
			},
		});
		return;
	}
	if (method === "notifications/initialized" || method === "initialized") {
		return;
	}
	if (method === "notifications/cancelled") {
		return;
	}
	if (method === "tools/list") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: { tools: toolsList() },
		});
		return;
	}
	if (method === "tools/call") {
		handleToolsCall(id, params);
		return;
	}
	if (method === "resources/list") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				resources: [
					{
						uri: NOTE_URI,
						name: "alpha",
						mimeType: "text/plain",
					},
				],
			},
		});
		return;
	}
	if (method === "resources/read") {
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
		return;
	}
	if (method === "ping") {
		writeMessage({ jsonrpc: "2.0", id, result: {} });
		return;
	}
	if (id !== undefined) {
		writeMessage({
			jsonrpc: "2.0",
			id,
			error: { code: -32601, message: `Method not found: ${method}` },
		});
	}
}

function consumeFramed() {
	const headerEnd = buffer.indexOf("\r\n\r\n");
	if (headerEnd === -1) {
		return false;
	}
	const header = buffer.subarray(0, headerEnd).toString("utf8");
	const match = header.match(/^Content-Length:\s*(\d+)/im);
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
	const line = buffer.subarray(0, newline).toString("utf8").replace(/\r$/, "").trim();
	buffer = buffer.subarray(newline + 1);
	if (!line || /^content-length:/i.test(line)) {
		return true;
	}
	replyMode = "ndjson";
	handleRequest(JSON.parse(line));
	return true;
}

function consume() {
	while (true) {
		const prefix = buffer.subarray(0, Math.min(buffer.length, 32)).toString("utf8").toLowerCase();
		if (prefix.startsWith("content-length")) {
			try {
				if (!consumeFramed()) {
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(`mcp-echo parse error: ${message}\n`);
				return;
			}
			continue;
		}
		try {
			if (!consumeNdjson()) {
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`mcp-echo parse error: ${message}\n`);
		}
	}
}

process.stdin.on("data", (chunk) => {
	buffer = Buffer.concat([buffer, chunk]);
	consume();
});

process.stdin.on("end", () => {
	process.exit(0);
});
