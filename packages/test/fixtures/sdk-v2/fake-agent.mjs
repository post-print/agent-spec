import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function gradeResponse(prompt, options) {
	const rubric = JSON.parse(prompt.split("Rubric:\n")[1].split("\nEvidence:")[0]);
	const scores = {},
		reasons = {},
		evidence = {};
	for (const key of Object.keys(rubric)) {
		scores[key] = Math.max(...Object.keys(rubric[key].scores).map(Number));
		reasons[key] = "Confirmed against the captured project guide.";
		evidence[key] = [
			{
				source: "workspace",
				snapshot: "final",
				path: "PROJECT.md",
				line: options.evidenceLine ?? 1,
			},
		];
	}
	return { type: "text", text: JSON.stringify({ scores, reasons, evidence }) };
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
					yield gradeResponse(prompt, options);
				} else {
					if (prompt.includes("WAIT_FOREVER")) await new Promise(() => {});
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
					yield { type: "text", text: `${answer} turn ${turns}` };
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
