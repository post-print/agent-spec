import { describe, expect, it } from "vitest";

import { suppressNoisyRuntimeWarnings } from "../warnings.js";

describe("suppressNoisyRuntimeWarnings", () => {
	it("registers a filter that drops SQLite ExperimentalWarning", () => {
		const seen: string[] = [];
		const priorError = console.error;
		console.error = (...args: unknown[]) => {
			seen.push(args.map(String).join(" "));
		};

		try {
			suppressNoisyRuntimeWarnings();

			const sqlite = Object.assign(new Error("SQLite is experimental"), {
				name: "ExperimentalWarning",
			});
			const other = Object.assign(new Error("something else"), {
				name: "Warning",
			});

			process.emit("warning", sqlite);
			process.emit("warning", other);

			expect(seen.some((line) => /SQLite/i.test(line))).toBe(false);
			expect(seen.some((line) => /something else/i.test(line))).toBe(true);
		} finally {
			console.error = priorError;
			process.removeAllListeners("warning");
		}
	});
});
