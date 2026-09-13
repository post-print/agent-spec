import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	clearRegisteredHostAdapters,
	createAdapter,
	isKnownAgentHost,
} from "@post-print/agent-harness";

import { loadHostAdapters } from "../load-adapters.js";

afterEach(() => {
	clearRegisteredHostAdapters();
});

describe("loadHostAdapters", () => {
	it("loads adapters from --adapter and a config file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-adapter-"));
		const adapterPath = join(dir, "echo-adapter.mjs");
		await writeFile(
			adapterPath,
			`
export const adapters = [{
  host: "echo",
  async run(options) {
    return {
      host: "echo",
      status: "completed",
      durationMs: 0,
      trace: { messages: [{ role: "assistant", content: options.prompt }], toolCalls: [], shellCommands: [], artifacts: {} },
    };
  },
  missingAuth() { return undefined; },
}];
`,
		);
		await writeFile(
			join(dir, "agent-test.config.mjs"),
			`
export const adapters = [{
  host: "cfg",
  async run(options) {
    return {
      host: "cfg",
      status: "completed",
      durationMs: 0,
      trace: { messages: [], toolCalls: [], shellCommands: [], artifacts: {} },
    };
  },
}];
`,
		);

		await loadHostAdapters({ cwd: dir, adapterModules: [adapterPath] });
		expect(isKnownAgentHost("echo")).toBe(true);
		expect(isKnownAgentHost("cfg")).toBe(true);
		expect(createAdapter("echo").host).toBe("echo");
	});

	it("rejects a missing adapter module", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-adapter-missing-"));
		await expect(
			loadHostAdapters({ cwd: dir, adapterModules: [join(dir, "nope.mjs")] }),
		).rejects.toThrow(/Adapter module not found/);
	});
});
