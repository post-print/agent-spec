import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../fixtures/catalog-server/server.mjs", import.meta.url));

/** An MCP server offering exactly these tools, so a suite can vary what an agent is offered. */
export function catalogServer(tools: { name: string; description: string }[]) {
	return { type: "stdio" as const, command: "node", args: [SERVER, JSON.stringify(tools)] };
}
