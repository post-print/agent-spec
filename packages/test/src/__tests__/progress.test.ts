import { describe, expect, it } from "vitest";

import { formatDuration } from "../progress.js";
import { truncatePath, wrapText } from "../theme.js";

describe("formatDuration", () => {
	it("formats sub-second durations in ms", () => {
		expect(formatDuration(42)).toBe("42ms");
	});

	it("formats longer durations in seconds", () => {
		expect(formatDuration(4500)).toBe("4.5s");
	});
});

describe("truncatePath / wrapText (progress helpers)", () => {
	it("exposes path truncation used by themed phases", () => {
		expect(truncatePath("/a/b/c/d")).toBe("…/c/d");
	});

	it("exposes wrapText for verdict rationales", () => {
		expect(wrapText("hello world", 5)).toEqual(["hello", "world"]);
	});
});
