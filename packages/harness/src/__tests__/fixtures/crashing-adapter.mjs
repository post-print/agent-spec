export default {
	capabilities: { conversation: "native" },
	createSession: async () => ({
		// biome-ignore lint/correctness/useYield: the worker dies before any event.
		async *run() {
			process.stderr.write("worker died token=hunter2\n");
			process.exit(7);
		},
		async close() {},
	}),
};
