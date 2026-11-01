import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { type McpServerConfig, resolveMcpServers } from "./mcp.js";

const CATALOG_TIMEOUT_MS = 5_000;
const PROTOCOL_VERSION = "2024-11-05";
const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "agent-harness-catalog", version: "1" },
	},
};
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST_TOOLS = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

export interface McpCatalogTool {
	name: string;
	description?: string;
}
export type McpCatalogEntry =
	| { server: string; status: "listed"; tools: McpCatalogTool[] }
	| { server: string; status: "failed"; error: string };

type RpcReply = { id?: unknown; result?: { tools?: McpCatalogTool[] } };
function toolsFrom(reply: RpcReply): McpCatalogTool[] {
	return (reply.result?.tools ?? []).map(({ name, description }) => ({ name, description }));
}
function parsedReply(line: string): RpcReply | undefined {
	try {
		return JSON.parse(line) as RpcReply;
	} catch {
		return undefined;
	}
}
function stdioTools(config: Extract<McpServerConfig, { command: string }>) {
	return new Promise<McpCatalogTool[]>((resolve, reject) => {
		const child = spawn(config.command, config.args ?? [], {
			cwd: config.cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "ignore"],
		});
		child.once("error", reject);
		child.once("close", () => reject(new Error("MCP server exited before listing tools")));
		const write = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("MCP server did not list its tools in time"));
		}, CATALOG_TIMEOUT_MS);
		createInterface({ input: child.stdout }).on("line", (line) => {
			const reply = parsedReply(line);
			if (reply?.id === 1) {
				write(INITIALIZED);
				write(LIST_TOOLS);
			}
			if (reply?.id !== 2) return;
			clearTimeout(timer);
			resolve(toolsFrom(reply));
			child.kill();
		});
		write(INITIALIZE);
	});
}
async function httpRpc(
	config: Extract<McpServerConfig, { url: string }>,
	message: object,
	sessionId?: string,
) {
	const response = await fetch(config.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...config.headers,
			...(sessionId ? { "mcp-session-id": sessionId } : {}),
		},
		body: JSON.stringify(message),
		signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`MCP server answered ${response.status}`);
	const text = await response.text();
	const data = text.split("\n").find((line) => line.startsWith("data:"));
	return {
		reply: parsedReply(data ? data.slice("data:".length) : text),
		sessionId: response.headers.get("mcp-session-id") ?? undefined,
	};
}
async function httpTools(config: Extract<McpServerConfig, { url: string }>) {
	const { sessionId } = await httpRpc(config, INITIALIZE);
	await httpRpc(config, INITIALIZED, sessionId);
	const { reply } = await httpRpc(config, LIST_TOOLS, sessionId);
	return toolsFrom(reply ?? {});
}
async function catalogEntry(name: string, config: McpServerConfig): Promise<McpCatalogEntry> {
	try {
		const tools = "command" in config ? await stdioTools(config) : await httpTools(config);
		return { server: name, status: "listed", tools };
	} catch (error) {
		return { server: name, status: "failed", error: (error as Error).message };
	}
}
/** Ask each configured server for its tools, independently of any host. Never throws for a server. */
export async function listMcpCatalog(
	servers: Record<string, McpServerConfig> | undefined,
	options: { cwd: string },
): Promise<McpCatalogEntry[]> {
	const resolved = resolveMcpServers(servers, options);
	if (!resolved) return [];
	return Promise.all(Object.entries(resolved).map(([name, config]) => catalogEntry(name, config)));
}
