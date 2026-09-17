import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function gradeResponse(prompt, options) {
	const input = JSON.parse(prompt.split("\nInput:\n")[1]);
	return {
		type: "text",
		text: options.invalidJson
			? "not json"
			: JSON.stringify(options.response ?? { correct: true, reason: "Verified", input }),
	};
}
async function* codingEvents({ prompt, workspace, answer, turns, progress }) {
	if (prompt.includes("WAIT_FOREVER")) await new Promise(() => {});
	if (prompt.includes("FAIL_NOW")) throw new Error("fake failure");
	const text = await readFile(join(workspace.path, "PROJECT.md"), "utf8");
	yield {
		type: "tool",
		name: "Read",
		args: { path: "PROJECT.md" },
		result: text,
		succeeded: true,
	};
	if (prompt.includes("edit")) await writeFile(join(workspace.path, "result.txt"), "done");
	yield {
		type: "tool",
		name: "Shell",
		args: { command: "npm test" },
		result: "passed",
		exitCode: 0,
		succeeded: true,
	};
	if (progress) yield { type: "text", text: progress };
	yield { type: "text", text: `${answer} turn ${turns}` };
}
export default {
	name: "fake",
	capabilities: {
		conversation: "native",
		toolCalls: true,
		commandExitCodes: true,
		fileReads: true,
		tokenUsage: true,
		readOnly: true,
	},
	async createSession({ options, workspace, signal, readOnly }) {
		let turns = 0;
		const answer = options.answer ?? "Mina";
		const totalTokens = options.tokens ?? 15;
		return {
			async *run(prompt) {
				signal.throwIfAborted();
				turns++;
				if (readOnly) {
					if (prompt.includes("WAIT_FOREVER")) await new Promise(() => {});
					yield gradeResponse(prompt, options);
				} else {
					yield* codingEvents({ prompt, workspace, answer, turns, progress: options.progress });
				}
				if (!options.omitUsage)
					yield {
						type: "usage",
						usage: { inputTokens: 10, outputTokens: 5, totalTokens },
					};
			},
			async close() {
				await writeFile(join(workspace.path, "closed.txt"), "closed");
			},
		};
	},
};
