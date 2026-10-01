import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export default {
	name: "storage-proof",
	capabilities: {
		conversation: "native",
		toolCalls: false,
		commandExitCodes: false,
		fileReads: false,
		tokenUsage: false,
		readOnly: false,
	},
	async createSession({ workspace, signal }) {
		return {
			async *run(prompt) {
				await writeFile(join(workspace.path, "changed.txt"), "recoverable source");
				yield { type: "text", text: "Changed source" };
				if (prompt === "fail") throw new Error("storage proof failure");
				if (prompt === "wait")
					await new Promise((_resolve, reject) => {
						if (signal.aborted) reject(signal.reason);
						else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
					});
			},
			async close() {},
		};
	},
};
