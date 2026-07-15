import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { AgentTrace } from "@agent-spec/harness";
import { enrichTrace } from "@agent-spec/harness";

export const LIVE_STAGING_DIR_NAME = "agent-spec";

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
	return join(tmpdir(), LIVE_STAGING_DIR_NAME, "sessions");
}

export function getLiveStagingSessionRoot(sessionId: string): string {
	return join(getLiveStagingRoot(), sessionId);
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
		`${slugifyScenarioName(scenarioName)}.json`,
	);
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
	if (!replayTrace) {
		return undefined;
	}

	if (recordFixtures) {
		return {
			path: resolve(options.repoRoot, replayTrace),
			kind: "fixture",
		};
	}

	if (!options.stagingSessionId) {
		throw new Error("stagingSessionId required for live staging recordings");
	}

	const slug = slugifyScenarioName(scenarioName);
	return {
		path: join(getLiveStagingSessionRoot(options.stagingSessionId), suiteName, `${slug}.json`),
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
