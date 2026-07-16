import chalk from "chalk";
import { afterEach, describe, expect, it } from "vitest";

import { configureCliColor, theme, truncatePath, wrapText } from "../theme.js";

describe("truncatePath", () => {
	afterEach(() => {
		delete process.env.AGENT_TEST_VERBOSE_PATHS;
	});

	it("keeps short paths intact", () => {
		expect(truncatePath("hello")).toBe("hello");
		expect(truncatePath("/tmp/foo")).toBe("/tmp/foo");
	});

	it("shortens long paths to last two segments", () => {
		expect(
			truncatePath(
				"/var/folders/f_/nwx/T/agent-harness-wt-Mh5osF/code-review-staged-merge-blockers-only",
			),
		).toBe("…/agent-harness-wt-Mh5osF/code-review-staged-merge-blockers-only");
	});

	it("returns full path when AGENT_TEST_VERBOSE_PATHS=1", () => {
		process.env.AGENT_TEST_VERBOSE_PATHS = "1";
		const full = "/a/b/c/d/e";
		expect(truncatePath(full)).toBe(full);
	});
});

describe("wrapText", () => {
	it("returns empty for blank input", () => {
		expect(wrapText("")).toEqual([]);
		expect(wrapText("   ")).toEqual([]);
	});

	it("wraps long text at column width", () => {
		const lines = wrapText("one two three four five six", 10);
		expect(lines.every((line) => line.length <= 10 || !line.includes(" "))).toBe(true);
		expect(lines.join(" ")).toBe("one two three four five six");
	});
});

describe("theme.scenarioVerdict", () => {
	const priorLevel = chalk.level;

	afterEach(() => {
		chalk.level = priorLevel;
	});

	it("renders PASS with judge rationale", () => {
		chalk.level = 0;
		const lines = theme.scenarioVerdict({
			passed: true,
			index: 1,
			total: 7,
			name: "staged: merge-blockers only",
			durationMs: 113_100,
			judgeVerdicts: [
				{
					id: "judge-0",
					question: "Does the review identify merge-blocking issues?",
					pass: true,
					rationale: "The agent flagged the missing null check.",
				},
			],
		});
		const joined = lines.join("\n");
		expect(joined).toContain("✓");
		expect(joined).toContain("PASS");
		expect(joined).toContain("[1/7]");
		expect(joined).toContain("staged: merge-blockers only");
		expect(joined).toContain("113.1s");
		expect(joined).toContain("judge");
		expect(joined).toContain("Does the review identify merge-blocking issues?");
		expect(joined).toContain("The agent flagged the missing null check.");
		expect(joined.includes("\u001b[")).toBe(false);
	});

	it("renders FAIL with judge and rubric reasons", () => {
		chalk.level = 0;
		const lines = theme.scenarioVerdict({
			passed: false,
			index: 5,
			total: 7,
			name: "pr: auth promotes full",
			durationMs: 131_500,
			judgeVerdicts: [
				{
					id: "judge-0",
					question: "Does the review surface auth security risks?",
					pass: false,
					rationale: "Did not mention the auth bypass.",
				},
			],
			rubricFailures: [
				{
					matcher: "mustNot:invoke-skill grill",
					message: "Agent invoked grill unexpectedly.",
				},
			],
		});
		const joined = lines.join("\n");
		expect(joined).toContain("✗");
		expect(joined).toContain("FAIL");
		expect(joined).toContain("judge");
		expect(joined).toContain("Did not mention the auth bypass.");
		expect(joined).toContain("rubric");
		expect(joined).toContain("mustNot:invoke-skill grill");
		expect(joined).toContain("Agent invoked grill unexpectedly.");
	});

	it("includes ANSI colors when chalk.level > 0", () => {
		chalk.level = 1;
		const lines = theme.scenarioVerdict({
			passed: true,
			name: "hello",
			durationMs: 2,
		});
		expect(lines.some((line) => line.includes("\u001b["))).toBe(true);
	});
});

describe("theme.summary", () => {
	it("keeps colon-separated suite summary for CLI regex compatibility", () => {
		chalk.level = 0;
		expect(theme.summary("smoke", 1, 0, 0)).toMatch(/smoke:.*1 passed/);
	});
});

describe("theme.banner", () => {
	it("prints a tight live banner without dogfood", () => {
		chalk.level = 0;
		expect(theme.banner("live")).toBe("agent-test  live");
		expect(theme.banner("live")).not.toContain("dogfood");
	});
});

describe("theme.suiteHeader", () => {
	it("uses compact host/count separators", () => {
		chalk.level = 0;
		expect(theme.suiteHeader("routing", "cursor", 4)).toBe("routing  ·  cursor  ·  4 scenarios");
	});
});

describe("configureCliColor", () => {
	const priorLevel = chalk.level;

	afterEach(() => {
		chalk.level = priorLevel;
	});

	it("always enables color, including when NO_COLOR is set", () => {
		process.env.NO_COLOR = "1";
		delete process.env.FORCE_COLOR;
		delete process.env.AGENT_TEST_COLOR;
		chalk.level = 0;
		configureCliColor();
		expect(chalk.level).toBe(3);
		delete process.env.NO_COLOR;
	});
});
