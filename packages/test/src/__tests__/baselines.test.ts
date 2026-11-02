import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baselineDirectory, readBaselines, saveBaselines } from "../sdk/baselines.js";
import { buildClaims, type ClaimSample, claimLines } from "../sdk/claims.js";
import { plannedSamples } from "../sdk/sampling.js";

const record = (overrides: Record<string, unknown> = {}) => ({
	host: "claude",
	binaryVersion: "1",
	requestedModel: "m",
	authMode: "subscription",
	confinement: "host-enforced",
	network: "disabled",
	hashes: { suite: "s", prompt: "p", skills: "k", tools: "t", settings: "o", initialSnapshot: "w" },
	...overrides,
});
const sample = (
	outcome: ClaimSample["outcome"],
	overrides: Partial<ClaimSample> = {},
): ClaimSample => ({
	claim: "claim",
	sample: { title: "claim", n: 2 },
	outcome,
	record: record(),
	...overrides,
});
const claimOf = (...samples: ClaimSample[]) => {
	const [claim] = buildClaims(samples);
	if (!claim) throw new Error("Expected one claim");
	return claim;
};

describe("baseline files", () => {
	let directory = "";
	let config = "";
	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "agent-test-baselines-"));
		config = join(directory, "agent-test.config.ts");
	});
	afterAll(() => rm(directory, { recursive: true, force: true }));
	const saved = async () => readdir(baselineDirectory(config)).catch(() => []);

	it("a claim that earned its rate is saved and read back", async () => {
		const result = await saveBaselines(config, [claimOf(sample("passed"), sample("failed"))]);
		expect(result.saved).toEqual(["claim"]);
		expect((await readBaselines(config)).records.claim).toMatchObject({ passed: 1, total: 2 });
	});
	it("a claim with runs that have no verdict is not saved, and says why", async () => {
		const before = await saved();
		const claim = claimOf(sample("passed"), sample("no_verdict"));
		const { saved: written, skipped } = await saveBaselines(config, [claim]);
		expect(written).toEqual([]);
		expect(skipped[0]?.reason).toContain("no verdict");
		expect(await saved()).toEqual(before);
	});
	it("a claim whose model nothing names is not saved", async () => {
		const unnamed = record({ requestedModel: undefined });
		const claim = claimOf(sample("passed", { record: unnamed }));
		expect(claim.fingerprint).toBeUndefined();
		expect((await saveBaselines(config, [claim])).saved).toEqual([]);
	});
	it("a claim with a surviving control is not saved", async () => {
		const claim = claimOf(sample("failed", { survivedControl: true }));
		expect((await saveBaselines(config, [claim])).skipped[0]?.reason).toContain("control");
	});
	it("a corrupt file is named rather than crashing the verdict", async () => {
		const folder = baselineDirectory(config);
		await writeFile(join(folder, "corrupt.json"), "{ not json");
		await writeFile(join(folder, "shape.json"), '{"claim":"x"}');
		const { records, unreadable } = await readBaselines(config);
		expect(unreadable.sort()).toEqual(["corrupt.json", "shape.json"]);
		expect(records.claim).toBeDefined();
	});
});

describe("conditions a rate depends on", () => {
	const arm = (variant: string, overrides: Record<string, unknown> = {}) =>
		sample("passed", {
			sample: { title: "claim", n: 1, variant, arms: ["a", "b"], subject: "prompt" },
			record: record(overrides),
		});
	for (const [field, change] of [
		["authMode", { authMode: "api-key" }],
		["settingSources", { settingSources: ["user"] }],
		["overridingEnv", { overridingEnv: ["CLAUDE_MODEL"] }],
		["hashes.tools", { hashes: { ...record().hashes, tools: "other" } }],
		["hashes.settings", { hashes: { ...record().hashes, settings: "other" } }],
	] as const)
		it(`arms that differ in ${field} are not compared`, () => {
			const claim = claimOf(arm("a"), arm("b", change));
			expect(claim.comparisonRefused).toContain(field);
		});
	it("runs of one arm that differ have no fingerprint, so no baseline applies", () => {
		const claim = claimOf(
			sample("passed"),
			sample("passed", { record: record({ binaryVersion: "2" }) }),
		);
		expect(claim.fingerprint).toBeUndefined();
	});
	it("a declared arm that never ran leaves no verdict, and is listed", () => {
		const claim = claimOf(arm("a"));
		expect(claim.decision).toBe("no_verdict");
		expect(claim.arms.map(({ variant }) => variant)).toEqual(["a", "b"]);
		expect(claim.comparisonRefused).toContain("arm b");
		expect(claimLines(claim).join("\n")).toContain("not compared");
	});
});

describe("planned samples", () => {
	it("refuses a third arm, which no comparison would cover", () => {
		expect(() => plannedSamples("t", { samples: 1, variants: ["a", "b", "c"] })).toThrow(
			"two arms",
		);
	});
	it("runs arms in a different order per execution", () => {
		const orderUnder = (id: string) => {
			process.env.AGENT_TEST_EXECUTION_ID = id;
			return plannedSamples("t", { samples: 8, variants: ["a", "b"] }).map(({ title }) => title);
		};
		const previous = process.env.AGENT_TEST_EXECUTION_ID;
		const [first, second] = [orderUnder("one"), orderUnder("two")];
		if (previous === undefined) delete process.env.AGENT_TEST_EXECUTION_ID;
		else process.env.AGENT_TEST_EXECUTION_ID = previous;
		expect(first).not.toEqual(second);
		expect([...(first ?? [])].sort()).toEqual([...(second ?? [])].sort());
	});
});
