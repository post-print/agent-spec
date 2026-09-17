import { expect, it } from "bun:test";
import { runCli } from "../cli.js";

it("rejects legacy JSON flags with migration guidance", async () => {
	await expect(runCli(["--suites-dir", "agent-suites"])).rejects.toThrow("TypeScript suite");
});
it("rejects unknown commands instead of launching an agent", async () => {
	await expect(runCli(["unknown"])).rejects.toThrow("Unsupported command");
});
