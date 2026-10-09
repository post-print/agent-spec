import { expect, it } from "bun:test";
import { resolve } from "node:path";
import { runCli } from "../cli.js";
import { viewerHint } from "../sdk/cli.js";

it("rejects legacy JSON flags with migration guidance", async () => {
	await expect(runCli(["--suites-dir", "agent-suites"])).rejects.toThrow("TypeScript suite");
});
it("rejects unknown commands instead of launching an agent", async () => {
	await expect(runCli(["unknown"])).rejects.toThrow("Unsupported command");
});
it("ends a run with the viewer command and asks an agent to check with the user first", () => {
	const executionId = "feed0000-0000-4000-8000-000000000001";
	const config = resolve("agent-suites/tour/agent-test.config.ts");
	const agent = viewerHint({ config, executionId, interactive: false, ci: false });
	expect(agent).toEqual([
		"View run feed0000: agent-test viewer --config agent-suites/tour/agent-test.config.ts",
		"Agent: ask the user whether to open the results viewer; start it only if they agree.",
	]);
	const person = viewerHint({
		config: resolve("agent-test.config.ts"),
		executionId,
		interactive: true,
		ci: false,
	});
	expect(person).toEqual(["View run feed0000: agent-test viewer"]);
	expect(viewerHint({ config, executionId, interactive: false, ci: true })).toEqual([]);
});
