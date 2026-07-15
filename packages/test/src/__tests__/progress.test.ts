import { describe, expect, it } from "vitest";

import { formatDuration } from "../progress";

describe("formatDuration", () => {
	it("formats sub-second durations in ms", () => {
		expect(formatDuration(42)).toBe("42ms");
	});

	it("formats longer durations in seconds", () => {
		expect(formatDuration(4500)).toBe("4.5s");
	});
});
