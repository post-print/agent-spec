import { afterEach, describe, expect, it, vi } from "vitest";

import { isTransientInfraError, withRetry } from "../retry.js";

describe("retry", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries transient infra errors", async () => {
		vi.useFakeTimers();
		let calls = 0;
		const promise = withRetry(
			async () => {
				calls++;
				if (calls < 3) {
					throw new Error("rate limit exceeded");
				}
				return "ok";
			},
			{
				maxAttempts: 3,
				baseDelayMs: 10,
				shouldRetry: (error) =>
					isTransientInfraError(error instanceof Error ? error.message : String(error)),
			},
		);
		await vi.runAllTimersAsync();
		const { result, attempt } = await promise;
		expect(result).toBe("ok");
		expect(attempt).toBe(3);
		expect(calls).toBe(3);
	});

	it("classifies transient error strings", () => {
		expect(isTransientInfraError("rate limit exceeded")).toBe(true);
		expect(isTransientInfraError("invalid JSON")).toBe(false);
	});
});
