import { describe, expect, it } from "bun:test";
import { buildClaims, type ClaimSample, claimLines } from "../sdk/claims.js";

const record = (overrides: Record<string, unknown> = {}) => ({
	host: "claude",
	binaryVersion: "1",
	confinement: "host-enforced",
	network: "disabled",
	requestedModel: "m",
	observedModel: "m",
	hashes: { suite: "s", prompt: "p", skills: "k", initialSnapshot: "w" },
	...overrides,
});
const sample = (
	outcome: ClaimSample["outcome"],
	extra: Partial<ClaimSample> = {},
): ClaimSample => ({
	claim: "claim",
	outcome,
	record: record(),
	...extra,
});
const arm = (variant: string, subject: "prompt" | "model" = "prompt") => ({
	title: "claim",
	variant,
	n: 1,
	subject,
});

describe("buildClaims", () => {
	it("excludes no-verdict runs from the rate while still counting them", () => {
		const [claim] = buildClaims([sample("passed"), sample("failed"), sample("no_verdict")]);
		expect(claim?.arms[0]).toMatchObject({ passed: 1, failed: 1, noVerdict: 1, total: 2 });
	});
	it("does not count skipped runs at all", () => {
		const [claim] = buildClaims([sample("passed"), sample("not_run")]);
		expect(claim?.arms[0]).toMatchObject({ passed: 1, total: 1, noVerdict: 0 });
	});
	it("allows the declared subject to differ and refuses anything else", () => {
		const hashes = { suite: "s", prompt: "other", skills: "k", initialSnapshot: "w" };
		const allowed = buildClaims([
			sample("passed", { sample: arm("a") }),
			sample("failed", { sample: arm("b"), record: record({ hashes }) }),
		]);
		expect(allowed[0]?.comparison).toBeDefined();
		const refused = buildClaims([
			sample("passed", { sample: arm("a") }),
			sample("failed", { sample: arm("b"), record: record({ binaryVersion: "2" }) }),
		]);
		expect(refused[0]?.comparison).toBeUndefined();
		expect(refused[0]?.comparisonRefused).toBe("binaryVersion differs between runs");
	});
	it("refuses a model difference unless the model is the subject", () => {
		const models = [
			sample("passed", { sample: arm("a", "model") }),
			sample("failed", { sample: arm("b", "model"), record: record({ observedModel: "n" }) }),
		];
		expect(buildClaims(models)[0]?.comparisonRefused).toBeUndefined();
	});
});

describe("baselines", () => {
	const [saved] = buildClaims(Array.from({ length: 27 }, () => sample("passed")));
	const baseline = {
		claim: "claim",
		fingerprint: saved?.fingerprint ?? "",
		passed: 27,
		total: 27,
		at: "now",
	};
	it("flags a drop under the same conditions", () => {
		const samples = [
			...Array.from({ length: 10 }, () => sample("passed")),
			...Array.from({ length: 17 }, () => sample("failed")),
		];
		const [claim] = buildClaims(samples, { claim: baseline });
		expect(claim?.baseline).toMatchObject({ status: "same_conditions", regressed: true });
	});
	it("never reads a model or host change as a regression", () => {
		const changed = record({ observedModel: "new-model" });
		const samples = Array.from({ length: 27 }, () => sample("failed", { record: changed }));
		const [claim] = buildClaims(samples, { claim: baseline });
		expect(claim?.baseline).toEqual({ status: "new_conditions" });
	});
});

describe("claimLines", () => {
	it("reads as a count with its uncertainty and claims no reliability", () => {
		const [claim] = buildClaims([sample("passed"), sample("passed"), sample("failed")]);
		const text = claimLines(claim ?? ({} as never)).join("\n");
		expect(text).toContain("2 of 3");
		expect(text).toContain("95% interval");
		expect(text.toLowerCase()).not.toContain("reliable");
	});
});
