#!/usr/bin/env node
// A stdio MCP server whose tools come from its argument, so a suite can vary the subject under test.
import { createInterface } from "node:readline";

const tools = JSON.parse(process.argv[2] ?? "[]");
const RECORD = { id: "TASK-104", owner: "Mina" };
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const listed = tools.map(({ name, description }) => ({
	name,
	description,
	inputSchema: {
		type: "object",
		properties: { id: { type: "string" } },
		required: ["id"],
	},
}));
function call(id, args) {
	const found = String(args?.id) === RECORD.id;
	reply(id, {
		isError: !found,
		content: [{ type: "text", text: found ? JSON.stringify(RECORD) : `No record for ${args?.id}` }],
	});
}
createInterface({ input: process.stdin }).on("line", (line) => {
	const { id, method, params } = JSON.parse(line);
	if (method === "initialize")
		reply(id, {
			protocolVersion: params?.protocolVersion ?? "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "catalog", version: "1" },
		});
	else if (method === "tools/list") reply(id, { tools: listed });
	else if (method === "tools/call") call(id, params?.arguments);
	else if (id !== undefined) reply(id, {});
});
