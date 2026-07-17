import { describe, expect, it } from "vitest";

import { inferReviewDepthFromText } from "../capture.js";

describe("inferReviewDepthFromText pass-class", () => {
	it("infers standard from targeted contextual pass label", () => {
		const depth = inferReviewDepthFromText(
			"Review · pr · Standard · Pass: targeted contextual · Escalation: Stayed targeted contextual",
		);
		expect(depth).toBe("standard");
	});

	it("infers thorough from Stayed Thorough escalation", () => {
		const depth = inferReviewDepthFromText("Escalation: Stayed Thorough (first baseline)");
		expect(depth).toBe("thorough");
	});
});
