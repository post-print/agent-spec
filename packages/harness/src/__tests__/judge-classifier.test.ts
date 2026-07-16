import { afterEach, describe, expect, it, vi } from "vitest";

const agentPrompt = vi.fn();

vi.mock("@cursor/sdk", () => ({
	Agent: {
		prompt: agentPrompt,
		create: vi.fn(),
	},
}));

describe("runJudgeClassifier", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("propagates rawStatus and sdkError when Agent.prompt does not finish", async () => {
		agentPrompt.mockResolvedValue({
			status: "error",
			result: "",
			error: { message: "rate limited", code: "RATE_LIMIT" },
		});

		const { runJudgeClassifier } = await import("../cursor-run.js");
		const result = await runJudgeClassifier({
			cwd: process.cwd(),
			prompt: "criterion?",
			apiKey: "test-key",
		});

		expect(result.status).toBe("failed");
		expect(result.rawStatus).toBe("error");
		expect(result.sdkError).toEqual({ message: "rate limited", code: "RATE_LIMIT" });
	});

	it("omits sdkError when the prompt finishes cleanly", async () => {
		agentPrompt.mockResolvedValue({
			status: "finished",
			result: '{"verdict":"yes","evidence":[],"rationale":"ok"}',
		});

		const { runJudgeClassifier } = await import("../cursor-run.js");
		const result = await runJudgeClassifier({
			cwd: process.cwd(),
			prompt: "criterion?",
			apiKey: "test-key",
		});

		expect(result.status).toBe("completed");
		expect(result.rawStatus).toBe("finished");
		expect(result.sdkError).toBeUndefined();
	});
});

describe("judgeTrace infra errors", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("includes SDK error detail in the verdict rationale", async () => {
		agentPrompt.mockResolvedValue({
			status: "error",
			result: "",
			error: { message: "upstream timeout", code: "TIMEOUT" },
		});

		const { judgeTrace } = await import("../judge.js");
		const result = await judgeTrace(
			{
				messages: [{ role: "assistant", content: "hello" }],
				toolCalls: [],
				shellCommands: [],
				artifacts: {},
			},
			[{ id: "c1", question: "Did the agent greet?" }],
			{ cwd: process.cwd(), apiKey: "test-key" },
		);

		expect(result.skipped).toBe(false);
		expect(result.verdicts).toHaveLength(1);
		const verdict = result.verdicts[0];
		expect(verdict?.pass).toBe(false);
		expect(verdict?.infraError).toContain("judge run status: failed");
		expect(verdict?.infraError).toContain("sdk: error");
		expect(verdict?.infraError).toContain("upstream timeout");
		expect(verdict?.rationale).toBe(verdict?.infraError);
		expect(verdict?.rawSdkStatus).toBe("error");
		expect(verdict?.sdkError).toEqual({ message: "upstream timeout", code: "TIMEOUT" });
		expect(verdict?.attempt).toBe(1);
		expect(verdict?.durationMs).toBeGreaterThanOrEqual(0);
		expect(verdict?.transcriptChars).toBeGreaterThan(0);
		expect(verdict?.promptChars).toBeGreaterThan(0);
	});
});
