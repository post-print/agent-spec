import { describe, expect, it } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../../fixtures/mcp-echo/server.mjs", import.meta.url));

function startServer(): {
	child: ChildProcess;
	stdin: NodeJS.WritableStream;
	readNdjson: () => Promise<Record<string, unknown>>;
	readFramed: () => Promise<Record<string, unknown>>;
} {
	const child = spawn(process.execPath, [serverPath], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const stdout = child.stdout;
	const stdin = child.stdin;
	if (!stdout || !stdin) {
		throw new Error("expected stdio pipes");
	}
	const chunks: Buffer[] = [];
	stdout.on("data", (chunk: Buffer) => {
		chunks.push(chunk);
	});

	const waitFor = async (ready: (text: string) => boolean): Promise<string> => {
		const deadline = Date.now() + 2_000;
		while (Date.now() < deadline) {
			const text = Buffer.concat(chunks).toString("utf8");
			if (ready(text)) {
				return text;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		throw new Error("mcp-echo produced no reply");
	};

	return {
		child,
		stdin,
		readNdjson: async () => {
			const text = await waitFor((value) => value.includes("\n"));
			const line = text.slice(0, text.indexOf("\n")).trim();
			return JSON.parse(line) as Record<string, unknown>;
		},
		readFramed: async () => {
			const text = await waitFor((value) => /Content-Length:\s*\d+\r\n\r\n/.test(value));
			const match = text.match(/Content-Length:\s*(\d+)\r\n\r\n([\s\S]*)/);
			if (!match?.[1] || match[2] === undefined) {
				throw new Error("missing Content-Length frame");
			}
			const length = Number(match[1]);
			return JSON.parse(match[2].slice(0, length)) as Record<string, unknown>;
		},
	};
}

async function stop(child: ChildProcess): Promise<void> {
	child.kill();
	await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
}

describe("mcp-echo fixture stdio protocol", () => {
	it("answers initialize over newline-delimited JSON-RPC", async () => {
		const session = startServer();
		session.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "agent-test", version: "0" },
				},
			})}\n`,
		);
		const message = await session.readNdjson();
		await stop(session.child);
		expect(message.id).toBe(1);
		expect((message.result as { serverInfo?: { name?: string } })?.serverInfo?.name).toBe(
			"mcp-echo",
		);
	});

	it("looks up the canned alpha note", async () => {
		const session = startServer();
		session.stdin.write(
			`${JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "lookup", arguments: { id: "alpha" } },
			})}\n`,
		);
		const message = await session.readNdjson();
		await stop(session.child);
		const result = message.result as { content?: Array<{ text?: string }> };
		expect(result.content?.[0]?.text).toBe("agent-test-mcp-read-ok-4b8d");
	});

	it("answers a Content-Length initialize frame", async () => {
		const session = startServer();
		const body = JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "agent-test", version: "0" },
			},
		});
		session.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
		const message = await session.readFramed();
		await stop(session.child);
		expect(message.id).toBe(1);
		expect((message.result as { serverInfo?: { name?: string } })?.serverInfo?.name).toBe(
			"mcp-echo",
		);
	});
});
