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
		const parsed = parseJudgeResponse('YES\n```js\n{"quote":"hello"}\n```');
		expect(parsed.valid).toBe(true);
		expect(parsed.pass).toBe(true);
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
