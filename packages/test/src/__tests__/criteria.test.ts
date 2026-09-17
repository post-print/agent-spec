import { describe, expect, it } from "bun:test";
import { derivedExpectCriteria } from "../sdk/criteria.js";

describe("derived expect criteria", () => {
	it("retains direct assertions in declaration order", () => {
		const criteria = derivedExpectCriteria(`async ({ agent }) => {
			const run = await agent.run({ prompt: "answer" });
			expect(run.output).toContain("Mina");
			expect(run).not.toHaveReadPath("SECRET.md");
		}`);
		expect(criteria).toEqual([
			'expect(run.output).toContain("Mina")',
			'expect(run).not.toHaveReadPath("SECRET.md")',
		]);
	});

	it("normalizes multiline, async, regex, and nested assertions deterministically", () => {
		const criteria = derivedExpectCriteria(`async () => {
			await expect(task()).rejects.toThrow(
				/invalid; value/,
			);
			expect(() => value({ nested: true })).toThrow("bad value");
		}`);
		expect(criteria).toEqual([
			"expect(task()).rejects.toThrow( /invalid; value/, )",
			'expect(() => value({ nested: true })).toThrow("bad value")',
		]);
	});

	it("ignores comments, strings, and property calls named expect", () => {
		const criteria = derivedExpectCriteria(`() => {
			// expect(comment).toBe(true);
			const text = "expect(string).toBe(true)";
			fixture.expect(value);
			expect(value).toBe(true);
		}`);
		expect(criteria).toEqual(["expect(value).toBe(true)"]);
	});
});
