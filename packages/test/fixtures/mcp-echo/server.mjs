#!/usr/bin/env node
/**
 * Minimal stdio MCP server with a single `echo` tool.
 * Speaks MCP JSON-RPC with Content-Length framing (no deps).
 */
import { Buffer } from "node:buffer";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "mcp-echo", version: "0.1.0" };

/** @type {Buffer} */
let buffer = Buffer.alloc(0);

function writeMessage(message) {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
	process.stdout.write(body);
}

function handleRequest(message) {
	const { id, method, params } = message;
	if (method === "initialize") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			},
		});
		return;
	}
	if (method === "notifications/initialized" || method === "initialized") {
		return;
	}
	if (method === "tools/list") {
		writeMessage({
			jsonrpc: "2.0",
			id,
			result: {
				tools: [
					{
						name: "echo",
						description: "Echo a text message back (fixture MCP tool).",
						inputSchema: {
							type: "object",
							properties: {
								text: { type: "string", description: "Text to echo" },
							},
							required: ["text"],
						},
					},
				],
			},
		});
		return;
	}
	if (method === "tools/call") {
		const name = params?.name;
		const args = params?.arguments ?? {};
		if (name !== "echo") {
			writeMessage({
				jsonrpc: "2.0",
				id,
				error: { code: -32601, message: `Unknown tool: ${name}` },
			});
			return;
		}
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

function consume() {
	while (true) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd === -1) {
			return;
		}
		const header = buffer.subarray(0, headerEnd).toString("utf8");
		const match = /Content-Length:\s*(\d+)/i.exec(header);
		if (!match) {
			buffer = buffer.subarray(headerEnd + 4);
			continue;
		}
		const length = Number(match[1]);
		const bodyStart = headerEnd + 4;
		if (buffer.length < bodyStart + length) {
			return;
		}
		const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
		buffer = buffer.subarray(bodyStart + length);
		try {
			handleRequest(JSON.parse(body));
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
