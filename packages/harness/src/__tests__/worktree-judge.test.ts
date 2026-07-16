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
