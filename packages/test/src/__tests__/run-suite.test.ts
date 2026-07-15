import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverSuites } from "../discover-suites.js";

describe("discoverSuites", () => {
	it("skips directories without scenarios.json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-"));
		await mkdir(join(dir, "empty-suite"));
		await mkdir(join(dir, "real-suite"));
		await writeFile(
			join(dir, "real-suite", "scenarios.json"),
			JSON.stringify({
				name: "real-suite",
				scenarios: [{ name: "x", prompt: "p", rubric: {} }],
			}),
		);

		const paths = await discoverSuites(dir);
		expect(paths).toEqual([join(dir, "real-suite", "scenarios.json")]);
	});
});
