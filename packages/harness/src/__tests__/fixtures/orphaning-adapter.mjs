import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

export default {
	capabilities: { conversation: "native" },
	createSession: async ({ options }) => ({
		// biome-ignore lint/correctness/useYield: the worker dies before any event.
		async *run() {
			const host = spawn("sleep", ["30"], { stdio: "ignore" });
			writeFileSync(options.pidFile, String(host.pid));
			process.kill(process.pid, "SIGKILL");
		},
		async close() {},
	}),
};
