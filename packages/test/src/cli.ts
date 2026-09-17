#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isCliMain } from "./cli-entry.js";
import { runHostLogin } from "./host-login.js";
import { runSdkCli } from "./sdk/cli.js";
import { runSdkViewerCli } from "./sdk/viewer.js";

export async function runCli(args: string[]): Promise<number> {
	const [command, ...rest] = args;
	if (command === "test") return runSdkCli(rest);
	if (command === "viewer") return runSdkViewerCli(rest);
	if (command === "login") {
		const { values } = parseArgs({
			args: rest,
			options: { host: { type: "string", default: "cursor" } },
		});
		return runHostLogin(values.host);
	}
	if (!command || command === "--help" || command === "-h") {
		console.log(
			"agent-test test [Playwright options]\nagent-test viewer [--config path] [--port number]\nagent-test login [--host cursor|openai|claude]\n\nConfigure agents in agent-test.config.ts. JSON suites and legacy scoring flags were removed.",
		);
		return 0;
	}
	throw new Error(
		`Unsupported command: ${command}. Use agent-test test with a TypeScript suite. Run agent-test --help for commands.`,
	);
}
if (isCliMain(process.argv[1], fileURLToPath(import.meta.url))) {
	runCli(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
