import { describe, expect, it } from "vitest";

import { buildRoutingContract } from "../routing-contract.js";

describe("buildRoutingContract", () => {
	it("includes hands-on tier announce guidance", () => {
		const text = buildRoutingContract("hands-on");
		expect(text).toContain("Tier: low");
		expect(text).toContain("before any tools");
	});

	it("includes hands-off ## Routing block guidance", () => {
		const text = buildRoutingContract("hands-off");
		expect(text).toContain("## Routing");
		expect(text).toContain("**Tier:**");
		expect(text).toContain("before tools");
	});
});
