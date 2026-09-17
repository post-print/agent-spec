import { spawn } from "node:child_process";
import { type AgentHost, loginCursorSdk, resolveOpenaiBin } from "@post-print/agent-harness";

async function spawnInherited(command: string, args: string[]): Promise<number> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			resolve(code ?? 1);
		});
	});
}

/** Login for one host. Cursor uses the SDK store. Codex uses `codex login`. */
export async function runHostLogin(
	host: AgentHost,
	options?: {
		log?: (line: string) => void;
		loginCursor?: typeof loginCursorSdk;
		spawn?: typeof spawnInherited;
	},
): Promise<number> {
	const log = options?.log ?? ((line) => console.log(line));
	if (host === "cursor") {
		const login = options?.loginCursor ?? loginCursorSdk;
		log("Opening the Cursor SDK login in the browser.");
		const result = await login({
			onLoginUrl: (url) => {
				log(url);
			},
		});
		log(result.email ? `Logged in as ${result.email}.` : "Cursor SDK login stored.");
		return 0;
	}
	if (host === "openai") {
		const spawnLogin = options?.spawn ?? spawnInherited;
		const bin = await resolveOpenaiBin();
		log("Starting `codex login`.");
		return await spawnLogin(bin, ["login"]);
	}
	if (host === "claude") {
		log(
			"Run the Claude Code CLI login, then retry. agent-test does not invent a Claude key store.",
		);
		return 1;
	}
	log(`Host "${host}" has no login command.`);
	return 1;
}
