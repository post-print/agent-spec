import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
	applyExternalRubrics,
	loadSuiteFile,
	parseRubricsFile,
	resolveRubricsPath,
} from "../load-suite.js";

const splitRubricSuite = fileURLToPath(
	new URL("../../fixtures/split-rubric/scenarios.json", import.meta.url),
);

describe("loadSuiteFile external rubrics", () => {
	it("merges sibling rubrics.json by scenario name", async () => {
		const suite = await loadSuiteFile(splitRubricSuite);
		const scenario = suite.scenarios.find((s) => s.name === "opaque hello");
		expect(scenario?.rubric.must).toEqual(["split-rubric suite ok"]);
		const scenariosRaw = await readFile(splitRubricSuite, "utf8");
		expect(scenariosRaw).not.toContain("split-rubric suite ok");
		expect(scenariosRaw).not.toContain('"must"');
	});

	it("prefers --rubrics-dir over sibling when present", async () => {
		const repo = await mkdtemp(join(tmpdir(), "agent-test-rubrics-dir-"));
		const suitesRoot = join(repo, "suites");
		const rubricsRoot = join(repo, "private-rubrics");
		await mkdir(join(suitesRoot, "parked"), { recursive: true });
		await mkdir(join(rubricsRoot, "parked"), { recursive: true });
		await writeFile(
			join(suitesRoot, "parked", "scenarios.json"),
			JSON.stringify({
				name: "parked",
				scenarios: [{ name: "a", prompt: "do the thing" }],
			}),
		);
		await writeFile(
			join(suitesRoot, "parked", "rubrics.json"),
			JSON.stringify({ scenarios: { a: { must: ["sibling-key"] } } }),
		);
		await writeFile(
			join(rubricsRoot, "parked", "rubrics.json"),
			JSON.stringify({ scenarios: { a: { must: ["parked-key"] } } }),
		);

		const suite = await loadSuiteFile(join(suitesRoot, "parked", "scenarios.json"), {
			rubricsDir: rubricsRoot,
		});
		expect(suite.scenarios[0]?.rubric.must).toEqual(["parked-key"]);
		await rm(repo, { recursive: true, force: true });
	});

	it("resolveRubricsPath finds scenarios.rubric.json sibling", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-rubric-alt-"));
		const suitePath = join(dir, "scenarios.json");
		await writeFile(suitePath, JSON.stringify({ name: "x", scenarios: [] }));
		await writeFile(
			join(dir, "scenarios.rubric.json"),
			JSON.stringify({ scenarios: { n: { mustNot: ["secret"] } } }),
		);
		expect(await resolveRubricsPath(suitePath)).toBe(join(dir, "scenarios.rubric.json"));
		await rm(dir, { recursive: true, force: true });
	});

	it("rejects rubrics for unknown scenario names", () => {
		expect(() =>
			applyExternalRubrics(
				{
					name: "s",
					scenarios: [{ name: "known", prompt: "p", rubric: {} }],
				},
				{ scenarios: { unknown: { must: ["x"] } } },
				"/tmp/rubrics.json",
			),
		).toThrow(/unknown scenario/);
	});

	it("parseRubricsFile requires scenarios map", () => {
		expect(() => parseRubricsFile({ scenarios: [] }, "/tmp/r.json")).toThrow(/scenarios/);
	});
});

describe("loadSuiteFile replay deprecation", () => {
	it("rejects replay hosts and replayTrace fields with migration guidance", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-replay-deprecated-"));
		const hostPath = join(dir, "host.json");
		const tracePath = join(dir, "trace.json");
		await writeFile(
			hostPath,
			JSON.stringify({
				name: "legacy",
				defaults: { host: "replay" },
				scenarios: [{ name: "legacy", prompt: "p", rubric: {} }],
			}),
		);
		await writeFile(
			tracePath,
			JSON.stringify({
				name: "legacy",
				scenarios: [{ name: "legacy", prompt: "p", replayTrace: "trace.json", rubric: {} }],
			}),
		);

		await expect(loadSuiteFile(hostPath)).rejects.toThrow(/deprecated and no longer supported/);
		await expect(loadSuiteFile(tracePath)).rejects.toThrow(/deprecated and no longer supported/);
		await rm(dir, { recursive: true, force: true });
	});
});
