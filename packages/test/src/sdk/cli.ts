import { relative, resolve } from "node:path";
import { startRecordedExecution } from "./execution-runner.js";

export { playwrightCli } from "./playwright-cli.js";

type RunnerArgument =
	| { kind: "config"; value: string; next: number }
	| { kind: "reporter"; value: string; next: number }
	| { kind: "pass"; value: string; next: number };
function runnerArgument(args: string[], index: number): RunnerArgument {
	const value = args[index] ?? "";
	if (value === "--config" || value === "-c")
		return { kind: "config", value: args[index + 1] ?? "agent-test.config.ts", next: index + 2 };
	if (value === "--reporter")
		return { kind: "reporter", value: args[index + 1] ?? "list", next: index + 2 };
	if (value.startsWith("--reporter="))
		return {
			kind: "reporter",
			value: value.slice("--reporter=".length) || "list",
			next: index + 1,
		};
	return { kind: "pass", value, next: index + 1 };
}
function runnerArguments(args: string[]) {
	let config = resolve("agent-test.config.ts");
	let reporter = "list";
	const passThrough: string[] = [];
	for (let index = 0; index < args.length; ) {
		const argument = runnerArgument(args, index);
		index = argument.next;
		switch (argument.kind) {
			case "config":
				config = resolve(argument.value);
				break;
			case "reporter":
				reporter = argument.value;
				break;
			case "pass":
				passThrough.push(argument.value);
		}
	}
	return { config, reporter, passThrough };
}
export async function runSdkCli(args: string[]): Promise<number> {
	const { config, reporter: requestedReporter, passThrough } = runnerArguments(args);
	const execution = await startRecordedExecution({
		config,
		args: passThrough,
		reporter: requestedReporter,
		onOutput: (line) => process.stdout.write(`${line}\n`),
	});
	const cancel = () => execution.cancel();
	process.once("SIGINT", cancel);
	try {
		const code = await execution.completed;
		if (!passThrough.includes("--list"))
			for (const line of viewerHint({
				config,
				executionId: execution.id,
				interactive: process.stdout.isTTY === true,
				ci: process.env.CI === "true",
			}))
				process.stdout.write(`${line}\n`);
		return code;
	} finally {
		process.removeListener("SIGINT", cancel);
	}
}

/**
 * Closing lines after a recorded run. A terminal user gets the command; a non-interactive
 * caller, usually a coding agent, is also told to ask before starting the viewer.
 */
export function viewerHint(input: {
	config: string;
	executionId: string;
	interactive: boolean;
	ci: boolean;
}): string[] {
	if (input.ci) return [];
	const configPath = relative(process.cwd(), input.config);
	const command =
		configPath === "agent-test.config.ts"
			? "agent-test viewer"
			: `agent-test viewer --config ${configPath}`;
	const lines = [`View run ${input.executionId.slice(0, 8)}: ${command}`];
	if (!input.interactive)
		lines.push(
			"Agent: ask the user whether to open the results viewer; start it only if they agree.",
		);
	return lines;
}
