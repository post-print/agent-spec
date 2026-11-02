export default {
	capabilities: { conversation: "native" },
	createSession: async ({ options }) => ({
		// biome-ignore lint/correctness/useYield: the adapter fails before any event.
		async *run() {
			throw new Error(options.message);
		},
		async close() {},
	}),
};
