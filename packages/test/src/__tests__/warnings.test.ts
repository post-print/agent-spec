import { describe, expect, it } from "vitest";

import { suppressNoisyRuntimeWarnings } from "../warnings.js";

describe("suppressNoisyRuntimeWarnings", () => {
	it("replaces the default printer and drops SQLite ExperimentalWarning", async () => {
		const seen: string[] = [];
		const priorError = console.error;
		console.error = (...args: unknown[]) => {
			seen.push(args.map(String).join(" "));
		};

		try {
			const defaultListeners = process.listenerCount("warning");
			expect(defaultListeners).toBeGreaterThanOrEqual(1);

			suppressNoisyRuntimeWarnings();
			expect(process.listenerCount("warning")).toBe(1);

			process.emitWarning(
				"SQLite is an experimental feature",
				"ExperimentalWarning",
			);
			process.emitWarning("something else", "Warning");
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(seen.some((line) => /SQLite/i.test(line))).toBe(false);
			expect(seen.some((line) => /something else/i.test(line))).toBe(true);
		} finally {
			console.error = priorError;
			process.removeAllListeners("warning");
		}
	});
});
