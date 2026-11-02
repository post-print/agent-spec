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
const FIRST_LIST_ID = 2;
function listToolsRequest(id: number, cursor?: string) {
	return { jsonrpc: "2.0", id, method: "tools/list", params: cursor ? { cursor } : {} };
}

export interface McpCatalogTool {
	name: string;
	description?: string;
}
export type McpCatalogEntry =
	| { server: string; status: "listed"; tools: McpCatalogTool[] }
	| { server: string; status: "failed"; error: string };

interface RpcReply {
	id?: unknown;
	/** Present when the server is asking the client something, not answering it. */
	method?: unknown;
	result?: { tools?: McpCatalogTool[]; nextCursor?: string };
	error?: { message?: string };
}
interface ToolPage {
	tools: McpCatalogTool[];
	nextCursor?: string;
}
function parsedReply(line: string): RpcReply | undefined {
	try {
		return JSON.parse(line) as RpcReply;
	} catch {
		return undefined;
	}
}
function answers(reply: RpcReply | undefined, id: number): boolean {
	return reply?.id === id && reply.method === undefined;
}
/** Anything but an explicit tool array throws: an errored listing must not read as an empty one. */
function toolPage(reply: RpcReply | undefined): ToolPage {
	if (reply?.error)
		throw new Error(`MCP server refused to list its tools: ${reply.error.message ?? "no reason"}`);
	const tools = reply?.result?.tools;
	if (!Array.isArray(tools)) throw new Error("MCP server did not answer with a tool list");
	return {
		tools: tools.map(({ name, description }) => ({ name, description })),
		nextCursor: reply?.result?.nextCursor,
	};
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
		const finish = (settle: () => void) => {
			clearTimeout(timer);
			settle();
			child.kill();
		};
		const tools: McpCatalogTool[] = [];
		let listId = FIRST_LIST_ID;
		const acceptPage = (reply: RpcReply) => {
			const page = toolPage(reply);
			tools.push(...page.tools);
			if (!page.nextCursor) return finish(() => resolve(tools));
			listId += 1;
			write(listToolsRequest(listId, page.nextCursor));
		};
		createInterface({ input: child.stdout }).on("line", (line) => {
			const reply = parsedReply(line);
			if (answers(reply, INITIALIZE.id)) {
				write(INITIALIZED);
				write(listToolsRequest(listId));
			}
			if (!reply || !answers(reply, listId)) return;
			try {
				acceptPage(reply);
			} catch (error) {
				finish(() => reject(error));
			}
		});
		write(INITIALIZE);
	});
}
interface HttpConversation {
	config: Extract<McpServerConfig, { url: string }>;
	/** One deadline for the whole listing, so a server that pages forever still ends. */
	deadline: AbortSignal;
	sessionId?: string;
}
/** A JSON body is the reply. An event stream can carry notifications before it. */
function replyIn(text: string, id: number | undefined): RpcReply | undefined {
	const events = text.split("\n").filter((line) => line.startsWith("data:"));
	const candidates = events.length ? events.map((line) => line.slice("data:".length)) : [text];
	return candidates.map(parsedReply).find((reply) => id !== undefined && answers(reply, id));
}
async function httpRpc(conversation: HttpConversation, message: { id?: number; method: string }) {
	const { config, deadline, sessionId } = conversation;
	const response = await fetch(config.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...config.headers,
			...(sessionId ? { "mcp-session-id": sessionId } : {}),
		},
		body: JSON.stringify(message),
		signal: deadline,
	});
	if (!response.ok) throw new Error(`MCP server answered ${response.status}`);
	return {
		reply: replyIn(await response.text(), message.id),
		sessionId: response.headers.get("mcp-session-id") ?? undefined,
	};
}
async function httpTools(config: Extract<McpServerConfig, { url: string }>) {
	const deadline = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
	const { sessionId } = await httpRpc({ config, deadline }, INITIALIZE);
	const conversation = { config, deadline, sessionId };
	await httpRpc(conversation, INITIALIZED);
	const tools: McpCatalogTool[] = [];
	let listId = FIRST_LIST_ID;
	let page = toolPage((await httpRpc(conversation, listToolsRequest(listId))).reply);
	tools.push(...page.tools);
	while (page.nextCursor) {
		listId += 1;
		page = toolPage((await httpRpc(conversation, listToolsRequest(listId, page.nextCursor))).reply);
		tools.push(...page.tools);
	}
	return tools;
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
