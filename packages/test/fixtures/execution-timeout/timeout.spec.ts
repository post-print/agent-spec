import { describe } from "../../dist/index.js";

const test = describe("stalled builtin", ({ agent }) => ({
	stalled: agent({ description: "Emits progress and then never completes." }),
}));

test("records an infrastructure timeout", async ({ stalled }) => {
	await stalled.run({ prompt: "Start, emit progress, then stall." });
});
