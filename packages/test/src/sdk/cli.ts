import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
export function playwrightCli(): string {
	return require.resolve("@playwright/test/cli");
}
export async function runSdkCli(args: string[]): Promise<number> {
	return new Promise((resolveCode, reject) => {
		const child = spawn(
			process.execPath,
			[playwrightCli(), "test", "--config", resolve("agent-test.config.ts"), ...args],
			{ stdio: "inherit" },
		);
		const cancel = () => child.kill("SIGTERM");
		process.once("SIGINT", cancel);
		child.once("error", reject);
		child.once("close", (code) => {
			process.removeListener("SIGINT", cancel);
			resolveCode(code ?? 1);
		});
	});
}
