import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const serverPath = fileURLToPath(new URL("../../fixtures/mcp-echo/server.mjs", import.meta.url));

describe("mcp-echo fixture stdio protocol", () => {
	it("answers initialize over newline-delimited JSON-RPC", async () => {
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

		const init = {
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "agent-test", version: "0" },
			},
		};
		stdin.write(`${JSON.stringify(init)}\n`);

		const deadline = Date.now() + 2_000;
		let line = "";
		while (Date.now() < deadline) {
			const text = Buffer.concat(chunks).toString("utf8");
			const newline = text.indexOf("\n");
			if (newline !== -1) {
				line = text.slice(0, newline).trim();
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		child.kill();
		await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);

		expect(line.length).toBeGreaterThan(0);
		const message = JSON.parse(line) as {
			id?: number;
			result?: { serverInfo?: { name?: string } };
		};
		expect(message.id).toBe(1);
		expect(message.result?.serverInfo?.name).toBe("mcp-echo");
	});
});
