import { describe, expect, it } from "bun:test";

import { buildOpenaiExecArgs } from "../openai-run.js";

describe("buildOpenaiExecArgs", () => {
	it("pins the Codex sandbox to the sealed workspace", () => {
		const args = buildOpenaiExecArgs({
			prompt: "Say hello.",
			cwd: "/tmp/agent-harness-seal-test",
		});
		expect(args.slice(0, 7)).toEqual([
			"exec",
			"--json",
			"--sandbox",
			"workspace-write",
			"--cd",
			"/tmp/agent-harness-seal-test",
			"--approve-for-me",
		]);
		expect(args.at(-1)).toBe("Say hello.");
	});

	it("uses a read-only sandbox for classifiers", () => {
		const args = buildOpenaiExecArgs({
			prompt: "yes or no",
			cwd: "/tmp/seal",
			sandbox: "read-only",
		});
		expect(args).toContain("read-only");
		expect(args).not.toContain("--approve-for-me");
	});
});
