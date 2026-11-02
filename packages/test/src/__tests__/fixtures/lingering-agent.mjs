import { spawn } from "node:child_process";

/** First turn starts a process in the workspace and leaves it running. Later turns do nothing. */
export default {
	name: "lingering",
	capabilities: { conversation: "native", toolCalls: true, tokenUsage: true },
	async createSession({ workspace }) {
		return {
			async *run(prompt) {
				if (prompt.includes("start")) {
					const child = spawn("sleep", ["30"], {
						cwd: workspace.path,
						detached: true,
						stdio: "ignore",
					});
					child.unref();
					yield { type: "text", text: String(child.pid) };
				} else yield { type: "text", text: "nothing to do" };
			},
			async close() {},
		};
	},
};
