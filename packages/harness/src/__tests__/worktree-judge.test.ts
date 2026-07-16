import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { parseJudgeJsonResponse, parseJudgeResponse } from "../judge.js";
import { cleanupStaleScenarioWorktrees, createScenarioWorktree } from "../worktree.js";

const execFileAsync = promisify(execFile);

async function initGitRepo(): Promise<string> {
	const repoRoot = await mkdtemp(join(tmpdir(), "agent-worktree-"));
	await execFileAsync("git", ["init", "-b", "main"], { cwd: repoRoot });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
	await execFileAsync("git", ["config", "user.name", "test"], { cwd: repoRoot });
	await writeFile(join(repoRoot, "AGENTS.md"), "# Agents\n", "utf8");
	await execFileAsync("git", ["add", "."], { cwd: repoRoot });
	await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoRoot });
	return repoRoot;
}

describe("parseJudgeJsonResponse", () => {
	it("parses bare JSON verdict", () => {
		const parsed = parseJudgeJsonResponse(
			'{"verdict":"yes","evidence":["Branch 1 and Branch 2"],"rationale":"Two branches named."}',
		);
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
		expect(parsed.evidence).toContain("Branch 1 and Branch 2");
	});

	it("parses fenced JSON", () => {
		const parsed = parseJudgeJsonResponse(
			'```json\n{"verdict":"no","evidence":[],"rationale":"No review block."}\n```',
		);
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(false);
	});

	it("marks invalid JSON", () => {
		const parsed = parseJudgeJsonResponse("YES\nMaybe.");
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
	});

	it("falls back to legacy YES/NO", () => {
		const parsed = parseJudgeResponse("YES\nTwo branches named.");
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("does not salvage YES/NO from invalid JSON objects", () => {
		const parsed = parseJudgeResponse(
			'{"verdict":"maybe","evidence":[],"rationale":"YES clearly"}',
		);
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
		expect(parsed.rationale).toMatch(/invalid JSON/i);
	});

	it("does not salvage YES/NO from JSON arrays", () => {
		const parsed = parseJudgeResponse('["yes"]');
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
	});

	it("does not extract inner objects from array-wrapped verdicts", () => {
		for (const raw of [
			'[{"verdict":"yes"}]',
			'[{"verdict":"no","rationale":"nope"}]',
			'[\n {"verdict":"yes","rationale":"looks good"}\n]',
			'Here is my answer:\n[{"verdict":"yes"}]',
			'```json\n[{"verdict":"yes"}]\n```',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
			expect(parsed.rationale).toMatch(/invalid JSON/i);
		}
	});

	it("does not salvage YES/NO from truncated JSON objects", () => {
		for (const raw of ['{"verdict":"yes"', '{"verdict":"no"', '```json\n{"verdict":"yes"\n```']) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
			expect(parsed.rationale).toMatch(/invalid JSON/i);
		}
	});

	it("does not extract inner objects from truncated JSON arrays", () => {
		for (const raw of [
			'[{"verdict":"yes"}',
			'[{"verdict":"no"',
			'```json\n[{"verdict":"yes"\n```',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
			expect(parsed.rationale).toMatch(/invalid JSON/i);
		}
	});

	it("still accepts prose-prefixed single JSON objects", () => {
		const parsed = parseJudgeResponse(
			'Here is my answer:\n{"verdict":"yes","evidence":[],"rationale":"ok"}',
		);
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("still salvages YES/NO when prose includes incidental JSON without verdict", () => {
		const parsed = parseJudgeResponse('YES\nEvidence: {"quote":"hello"}');
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("still salvages YES/NO when prose mentions verdict instructionally", () => {
		const parsed = parseJudgeResponse('YES\nThe schema uses "verdict": yes|no.');
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("refuses salvage for prose-prefixed truncated verdict objects", () => {
		const parsed = parseJudgeResponse('Here is my answer:\n{"verdict":"yes"');
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
		expect(parsed.rationale).toMatch(/invalid JSON/i);
	});

	it("refuses salvage for whole-text objects without verdict", () => {
		const parsed = parseJudgeResponse('{"evidence":[],"rationale":"YES clearly"}');
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
	});

	it("still salvages YES/NO when prose includes incidental arrays", () => {
		for (const raw of [
			"YES\nScores: [1,2,3]",
			'NO\nMissing sections: ["intro","summary"]',
			'YES\nMatches: [{"quote":"hello"}]',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(true);
		}
	});

	it("still salvages YES/NO when prose includes a truncated incidental blob", () => {
		const parsed = parseJudgeResponse('YES\nEvidence: {"quote":"hello"');
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("still salvages YES/NO when prose mentions json fences", () => {
		for (const raw of ["YES\nDo not use ```json fences.", 'YES\n```json\n{"quote":"hello"}\n```']) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(true);
			expect(parsed.pass).toBe(true);
		}
	});

	it("refuses salvage for verdict-shaped arrays inside prose", () => {
		for (const raw of ['YES\n[{"verdict":"yes"}]', 'Sure:\n[{"verdict":"no"}']) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
			expect(parsed.rationale).toMatch(/invalid JSON/i);
		}
	});

	it("refuses salvage for fenced truncated contract attempts", () => {
		const parsed = parseJudgeResponse('```json\n{"verdict":"yes"');
		expect(parsed.valid).toBe(false);
		expect(parsed.pass).toBe(false);
	});

	it("does not salvage YES/NO from whole-text JSON string primitives", () => {
		for (const raw of ['"yes"', '"no"', '  "YES"  ', '"YES."']) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
		}
	});

	it("does not salvage YES/NO from fenced JSON string primitives", () => {
		for (const raw of [
			'```\n"yes"\n```',
			'```json\n"yes"\n```',
			'```\n"no"\n```',
			'```js\n"yes"\n```',
			'```typescript\n"yes"\n```',
			'```jsonc\n"yes"\n```',
			'```python\n"no"\n```',
			'Answer:\n```json\n"yes"\n```',
			'Here is my verdict:\n```json\n"no"\n```',
			'Answer:\n```js\n"yes"\n```',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
		}
	});

	it("does not salvage from whole-text non-string JSON primitives", () => {
		for (const raw of ["42", "true", "null"]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid).toBe(false);
			expect(parsed.pass).toBe(false);
		}
	});

	it("does not salvage YES/NO from JSON primitives with trailing junk", () => {
		for (const raw of [
			'"yes" clearly',
			'"yes"\nrationale',
			'"no" because',
			'"yes",',
			"42\nYES",
			"true\nYES",
			"null YES",
			'```\n"yes" clearly\n```',
			'```json\n"yes" clearly\n```',
			'```js\n"yes" clearly\n```',
			"```js\n42\nYES\n```",
			"```typescript\ntrue\nYES\n```",
			"```jsonc\nnull YES\n```",
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
		}
	});

	it("still salvages YES/NO when prose incidentally contains a quoted verdict", () => {
		const parsed = parseJudgeResponse('YES\nThe answer is "yes" clearly.');
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
	});

	it("still salvages YES/NO when prose mentions non-json fences with incidental blobs", () => {
		for (const raw of [
			'YES\n```js\n{"quote":"hello"}\n```',
			'YES\n```js\n"yes"\n```',
			"YES\n```js\n[1,2,3]\n```",
			'NO\n```typescript\n"no"\n```',
			"YES\n```jsonc\n42\n```",
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(raw.startsWith("YES"));
		}
	});

	it("still salvages YES/NO from digit-prefixed numbered-list prose", () => {
		for (const raw of [
			"1. The transcript shows a greeting.\nYES",
			"2. Findings follow.\nYES",
			"10) Item complete.\nYES",
			" 1. x\nYES",
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(true);
		}
	});

	it("still salvages YES/NO from digit-prefixed English prose", () => {
		for (const [raw, pass] of [
			["3 findings support this.\nYES", true],
			["12 files changed.\nNO", false],
			["1 finding:\nYES", true],
		] as const) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(pass);
		}
	});

	it("still salvages YES/NO from digit/bool/null + comma English prose", () => {
		for (const [raw, pass] of [
			["3, findings support this.\nYES", true],
			["12, files changed.\nNO", false],
			["1, 2, and 3 findings.\nYES", true],
			["true, the agent greeted.\nYES", true],
			["false, but it did greet.\nYES", true],
			["null, nothing relevant.\nNO", false],
		] as const) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(pass);
		}
	});

	it("still latches digit/bool/null + comma contract junk", () => {
		for (const raw of ["42,", "3, YES", "true,\nYES", "null, NO"]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
		}
	});

	it("still salvages YES/NO from English true/false/null-prefixed prose", () => {
		for (const [raw, pass] of [
			["true story:\nYES", true],
			["null findings for this criterion.\nNO", false],
			["false alarm — the agent did greet.\nYES", true],
		] as const) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(pass);
		}
	});

	it("refuses salvage for prose-prefixed yes/no string arrays", () => {
		for (const raw of [
			'Here is my answer:\n["yes"]',
			'Sure:\n["yes"]',
			'Answer:\n["YES"]',
			'Answer:\n["yes","no"]',
			'Answer:\n["no"]',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
			expect(parsed.rationale, raw).toMatch(/invalid JSON/i);
		}
	});

	it("refuses salvage for prose-prefixed yes/no string peels and truncated arrays", () => {
		for (const raw of [
			'Answer:\n"yes"',
			'Here is my answer:\n"no"',
			'Answer:\n"yes" clearly',
			'Answer:\n["yes"',
			'Answer:\n"yes',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
			expect(parsed.rationale, raw).toMatch(/invalid JSON/i);
		}
	});

	it("refuses salvage for same-line JSON peels after answer/verdict/line 1 prefixes", () => {
		for (const raw of [
			'Answer: "yes"',
			'Answer: "YES"',
			'Answer: "no"',
			'Verdict: "no"',
			'Verdict: "yes"',
			'Line 1: "yes"',
			'line 1: "NO"',
			'Answer: ["yes"',
			'Answer: ["yes"]',
			'Verdict: ["no"]',
			'Answer: "yes" clearly',
			"Answer: 42",
			"Answer: true",
			"Answer: null",
			"Answer: 42\nYES",
			"Verdict: true\nYES",
			"Line 1: null\nNO",
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
			expect(parsed.rationale, raw).toMatch(/invalid JSON/i);
		}
	});

	it("refuses salvage for prose-prefixed number/bool/null then YES/NO", () => {
		for (const raw of [
			"Answer:\n42\nYES",
			"Answer:\ntrue\nYES",
			"Answer:\nfalse\nYES",
			"Answer:\nnull\nNO",
			"Verdict:\n42\nYES",
			"Sure:\n42\nYES",
			"Here is my answer:\ntrue\nYES",
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
			expect(parsed.rationale, raw).toMatch(/invalid JSON/i);
		}
	});

	it("still salvages unquoted Answer/Verdict YES/NO and incidental quote prose", () => {
		for (const [raw, pass] of [
			["Answer: YES", true],
			["Verdict: NO", false],
			["Line 1: YES\nEvidence follows.", true],
			['The answer is "yes" clearly.', true],
			['YES\nThe answer is "yes" clearly.', true],
		] as const) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(true);
			expect(parsed.pass, raw).toBe(pass);
		}
	});

	it("refuses salvage for prose-prefixed schema objects without verdict", () => {
		for (const raw of [
			'Here is my answer:\n{"evidence":[],"rationale":"YES clearly"}',
			'Analysis:\n{"evidence":[],"rationale":"YES clearly"}',
			'Answer:\n\n{"evidence":[],"rationale":"YES"}',
		]) {
			const parsed = parseJudgeResponse(raw);
			expect(parsed.valid, raw).toBe(false);
			expect(parsed.pass, raw).toBe(false);
			expect(parsed.rationale, raw).toMatch(/invalid JSON/i);
		}
	});
});

describe("createScenarioWorktree", () => {
	it("creates a detached worktree and cleans up", async () => {
		const repoRoot = await initGitRepo();
		const worktree = await createScenarioWorktree(repoRoot, "harness-test");
		try {
			const { access } = await import("node:fs/promises");
			await access(join(worktree.path, "AGENTS.md"));
		} finally {
			await worktree.cleanup();
		}
	});

	it("cleanupStaleScenarioWorktrees removes orphaned agent-test worktrees", async () => {
		const repoRoot = await initGitRepo();
		await createScenarioWorktree(repoRoot, "harness-stale-test");
		const removed = await cleanupStaleScenarioWorktrees(repoRoot);
		expect(removed.some((path) => path.includes("harness-stale-test"))).toBe(true);
		const { stdout } = await execFileAsync("git", ["worktree", "list"], { cwd: repoRoot });
		expect(stdout).not.toContain("harness-stale-test");
	});
});
