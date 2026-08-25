import { describe, expect, it, jest } from "bun:test";

import {
	AgentRunTimeoutError,
	isUserInputTool,
	traceHasUserInputTool,
	UserInputRequiredError,
	withRunTimeout,
} from "../run-guards.js";

describe("isUserInputTool", () => {
	it("matches AskQuestion-style tool names", () => {
		expect(isUserInputTool("AskQuestion")).toBe(true);
		expect(isUserInputTool("ask_question")).toBe(true);
		expect(isUserInputTool("AskUserQuestion")).toBe(true);
		expect(isUserInputTool("ask_user_question")).toBe(true);
		expect(isUserInputTool("request_user_input")).toBe(true);
	});

	it("does not match ordinary tools", () => {
		expect(isUserInputTool("Read")).toBe(false);
		expect(isUserInputTool("shell")).toBe(false);
	});
});

describe("traceHasUserInputTool", () => {
	it("detects user-input tools in a trace", () => {
		expect(traceHasUserInputTool([{ name: "Read" }, { name: "AskQuestion" }])).toBe(true);
		expect(traceHasUserInputTool([{ name: "Grep" }])).toBe(false);
	});
});

describe("withRunTimeout", () => {
	it("resolves when the operation finishes in time", async () => {
		await expect(withRunTimeout(async () => "ok", 100)).resolves.toBe("ok");
	});

	it("rejects with AgentRunTimeoutError when the deadline is exceeded", async () => {
		const late = withRunTimeout(
			() =>
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("late"), 200);
				}),
			50,
		);
		await expect(late).rejects.toBeInstanceOf(AgentRunTimeoutError);
	});

	it("invokes onTimeout before rejecting", async () => {
		const onTimeout = jest.fn();
		const late = withRunTimeout(
			() =>
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("late"), 200);
				}),
			50,
			{ onTimeout },
		);
		await expect(late).rejects.toBeInstanceOf(AgentRunTimeoutError);
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it("rejects on deadline even when onTimeout does not settle", async () => {
		const onTimeout = jest.fn(() => new Promise<void>(() => {}));
		const late = withRunTimeout(
			() =>
				new Promise<string>((resolve) => {
					setTimeout(() => resolve("late"), 200);
				}),
			50,
			{ onTimeout },
		);
		await expect(late).rejects.toBeInstanceOf(AgentRunTimeoutError);
		expect(onTimeout).toHaveBeenCalledOnce();
	});
});

describe("UserInputRequiredError", () => {
	it("names the blocking tool in the message", () => {
		const error = new UserInputRequiredError("AskQuestion");
		expect(error.message).toContain("AskQuestion");
		expect(error.message).toContain("headless mode");
	});
});
