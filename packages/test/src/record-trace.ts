import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { AgentTrace } from "@post-print/agent-harness";
import { enrichTrace } from "@post-print/agent-harness";

import type { AssertionFailure } from "./types.js";

export const LIVE_STAGING_DIR_NAME = "agent-spec";

let liveStagingRootOverride: string | undefined;

/** Override the sessions parent (default: `$TMPDIR/agent-spec`). Used by `--debug-dir`. */
export function setLiveStagingRootOverride(root: string | undefined): void {
	liveStagingRootOverride = root?.trim() ? root : undefined;
}

export function getLiveStagingRootOverride(): string | undefined {
	return liveStagingRootOverride;
}

function slugifyScenarioName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "scenario"
	);
}

export function getLiveStagingRoot(): string {
	if (liveStagingRootOverride) {
		return join(liveStagingRootOverride, "sessions");
	}
	return join(tmpdir(), LIVE_STAGING_DIR_NAME, "sessions");
}

export function getLiveStagingSessionRoot(sessionId: string): string {
	return join(getLiveStagingRoot(), sessionId);
}

function stagingScenarioBasename(scenarioName: string): string {
	return slugifyScenarioName(scenarioName);
}

/** Staging JSON path for a live scenario trace (matches recordTrace layout). */
export function getStagingTracePath(
	stagingSessionId: string,
	suiteName: string,
	scenarioName: string,
): string {
	return join(
		getLiveStagingSessionRoot(stagingSessionId),
		suiteName,
		`${stagingScenarioBasename(scenarioName)}.json`,
	);
}

/** Parent arms subprocess kill from this marker (epoch ms) when the harness deadline starts. */
export function getStagingAgentStartPath(
	stagingSessionId: string,
	suiteName: string,
	scenarioName: string,
): string {
	return join(
		getLiveStagingSessionRoot(stagingSessionId),
		suiteName,
		`${stagingScenarioBasename(scenarioName)}.agent-start`,
	);
}

/** Child writes when the harness agent deadline clock starts (after pre-stream SDK setup). */
export async function writeAgentStartMarker(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${Date.now()}\n`, "utf8");
}

/** Parent reads agent-start epoch ms from staging; undefined when absent or invalid. */
export async function readAgentStartMarker(path: string): Promise<number | undefined> {
	try {
		const raw = (await readFile(path, "utf8")).trim();
		const parsed = Number(raw);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Parent reads rubric failures from isolated child runs when exit code is non-zero. */
export function getStagingResultPath(
	stagingSessionId: string,
	suiteName: string,
	scenarioName: string,
): string {
	return join(
		getLiveStagingSessionRoot(stagingSessionId),
		suiteName,
		`${stagingScenarioBasename(scenarioName)}.result.json`,
	);
}

export interface LiveScenarioResultSidecar {
	passed: boolean;
	failures: AssertionFailure[];
	durationMs: number;
}

export function createLiveStagingSessionId(): string {
	return `${process.pid}-${Date.now()}`;
}

export type RecordingPathKind = "staging" | "fixture";

export interface ResolvedRecordingPath {
	path: string;
	kind: RecordingPathKind;
}

export interface ResolveRecordingPathOptions {
	repoRoot: string;
	stagingSessionId?: string;
}

/** Staging lives under $TMPDIR; use --record-fixtures to overwrite committed replayTrace. */
export function resolveRecordingPath(
	suiteName: string,
	scenarioName: string,
	replayTrace: string | undefined,
	recordFixtures: boolean,
	options: ResolveRecordingPathOptions,
): ResolvedRecordingPath | undefined {
	if (recordFixtures) {
		if (!replayTrace) {
			return undefined;
		}
		return {
			path: resolve(options.repoRoot, replayTrace),
			kind: "fixture",
		};
	}

	if (!options.stagingSessionId) {
		return undefined;
	}

	return {
		path: getStagingTracePath(options.stagingSessionId, suiteName, scenarioName),
		kind: "staging",
	};
}

/** Persist a live trace for replay regression (strip raw SDK payload). */
export async function recordTrace(outputPath: string, trace: AgentTrace): Promise<string> {
	const enriched = enrichTrace(trace);
	const payload = {
		messages: enriched.messages,
		toolCalls: enriched.toolCalls,
		shellCommands: enriched.shellCommands,
		gitDiff: enriched.gitDiff,
		prBody: enriched.prBody,
		artifacts: enriched.artifacts,
		routing: enriched.routing,
		skillsInvoked: enriched.skillsInvoked,
		judgeVerdicts: enriched.judgeVerdicts,
	};

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	return outputPath;
}

/** Load a staged live trace for parent-process judge after isolated child runs. */
export async function loadStagingTrace(path: string): Promise<AgentTrace> {
	const raw = JSON.parse(await readFile(path, "utf8")) as AgentTrace;
	return enrichTrace(raw);
}

/** Child writes rubric outcome for parent when live scenarios run in subprocess isolation. */
export async function writeStagingResult(
	path: string,
	result: LiveScenarioResultSidecar,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

/** Parent merges child rubric failures instead of only reporting subprocess exit code. */
export async function loadStagingResult(
	path: string,
): Promise<LiveScenarioResultSidecar | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as LiveScenarioResultSidecar;
	} catch {
		return undefined;
	}
}

/** Remove a live staging session directory under $TMPDIR. */
export async function cleanupStagingSession(sessionRoot: string): Promise<void> {
	await rm(sessionRoot, { recursive: true, force: true });
}

/** Remove legacy in-repo staging dirs from before tmpdir staging (best-effort). */
export async function cleanupLegacyRepoRecordings(repoRoot: string): Promise<string[]> {
	const suitesRoot = join(repoRoot, "agent-suites");
	const removed: string[] = [];

	let suiteNames: string[];
	try {
		suiteNames = await readdir(suitesRoot);
	} catch {
		return removed;
	}

	for (const suiteName of suiteNames) {
		const recordingsDir = join(suitesRoot, suiteName, "fixtures", "recordings");
		try {
			await stat(recordingsDir);
			await rm(recordingsDir, { recursive: true, force: true });
			removed.push(recordingsDir);
		} catch {
			// absent
		}
	}

	return removed;
}
