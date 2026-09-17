import { expect, it } from "bun:test";
import { createTestCatalog } from "../viewer/test-catalog.js";

it("test catalog › groups discovered tests by project without inventing hosts", () => {
	const catalog = createTestCatalog("/workspace/agent-test.config.ts", [
		{
			id: "a",
			file: "/workspace/tests/hello.spec.ts",
			title: "hello › greets",
			project: "chromium",
		},
		{
			id: "b",
			file: "/workspace/tests/hello.spec.ts",
			title: "hello › greets",
			project: "firefox",
		},
	]);
	expect(catalog.projects).toEqual(["chromium", "firefox"]);
	expect(catalog.tests).toEqual([
		{ id: "a", file: "tests/hello.spec.ts", title: ["hello", "greets"], project: "chromium" },
		{ id: "b", file: "tests/hello.spec.ts", title: ["hello", "greets"], project: "firefox" },
	]);
	expect(catalog.fingerprint).toHaveLength(16);
});

it("test catalog › retains structured pass criteria", () => {
	const catalog = createTestCatalog("/workspace/agent-test.config.ts", [
		{
			id: "a",
			file: "/workspace/tests/hello.spec.ts",
			title: "hello › greets",
			project: "default",
			criteria: ["The response says hello.", "No files change."],
		},
	]);
	expect(catalog.tests[0]?.criteria).toEqual(["The response says hello.", "No files change."]);
});

it("test catalog › preserves Playwright discovery order", () => {
	const catalog = createTestCatalog("/workspace/agent-test.config.ts", [
		{
			id: "first",
			file: "/workspace/tests/suite.spec.ts",
			title: "suite › z declared first",
			project: "default",
		},
		{
			id: "second",
			file: "/workspace/tests/suite.spec.ts",
			title: "suite › a declared second",
			project: "default",
		},
	]);
	expect(catalog.tests.map((test) => test.id)).toEqual(["first", "second"]);
});
