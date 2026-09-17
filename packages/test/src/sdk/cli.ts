import { resolve } from "node:path";
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
		return await execution.completed;
	} finally {
		process.removeListener("SIGINT", cancel);
	}
}
