import { describe, expect, it } from "vitest";

import { runWithWorkers } from "../scenario-scheduler.js";

describe("runWithWorkers", () => {
	it("preserves input order", async () => {
		const results = await runWithWorkers([3, 1, 2], 2, async (n) => {
			await new Promise((r) => setTimeout(r, (4 - n) * 5));
			return n * 10;
		});
		expect(results).toEqual([30, 10, 20]);
	});

	it("respects concurrency cap", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		await runWithWorkers([1, 2, 3, 4, 5], 2, async () => {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, 20));
			inFlight--;
			return true;
		});
		expect(maxInFlight).toBeLessThanOrEqual(2);
	});

	it("propagates errors", async () => {
		await expect(
			runWithWorkers([1, 2], 2, async (n) => {
				if (n === 2) {
					throw new Error("boom");
				}
				return n;
			}),
		).rejects.toThrow("boom");
	});

	it("handles empty lists", async () => {
		expect(await runWithWorkers([], 4, async () => 1)).toEqual([]);
	});
});
