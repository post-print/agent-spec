import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { claimKey } from "../sdk/claims.js";
import {
	type ExecutionSummary,
	listExecutionHistory,
	readExecutionDetail,
	readExecutionEvents,
	recoverExecutionHistory,
} from "../sdk/execution-store.js";
import type { RunVerdict, VerdictResult } from "../sdk/verdict.js";
import { RUN_VERDICTS, type TestRunStatus } from "./presentation.js";

/**
 * Stored files are read back with a cast, and anything may have written them. This is where the
 * viewer stops trusting their shape, so the page below it can read every field it was promised.
 */
const RUN_STATUSES = ["running", "passed", "failed", "interrupted"] as const;
const TEST_STATUSES = ["queued", "running", "passed", "failed", "skipped", "interrupted"];

const storedVerdict = z.looseObject({
	verdict: z.enum(RUN_VERDICTS),
	exitCode: z.number(),
	tests: z.record(z.string(), z.enum(RUN_VERDICTS)),
	claimVerdicts: z.record(z.string(), z.enum(RUN_VERDICTS)).optional(),
	counts: z.looseObject({ passed: z.number(), total: z.number() }),
	claims: z.array(
		z.looseObject({
			claim: z.string(),
			arms: z.array(
				z.looseObject({
					passed: z.number(),
					failed: z.number(),
					noVerdict: z.number(),
					total: z.number(),
					interval: z.looseObject({ low: z.number(), high: z.number() }),
				}),
			),
			controlsSurvived: z.number().optional(),
			decision: z.enum(["flagged", "clear", "measured", "no_verdict"]),
			baseline: z.looseObject({ status: z.string() }),
		}),
	),
	notRun: z.number().optional(),
	unreadableBaselines: z.array(z.string()).optional(),
});

export type ViewerSummary = Omit<ExecutionSummary, "status" | "testStatuses" | "verdict"> & {
	status: ExecutionSummary["status"] | "unknown";
	testStatuses: Record<string, TestRunStatus>;
	verdict?: VerdictResult;
	verdictUnreadable?: boolean;
	testClaims?: Record<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function readableDate(value: unknown): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : "";
}
function readableStatus(value: unknown): ViewerSummary["status"] {
	return RUN_STATUSES.find((status) => status === value) ?? "unknown";
}
function readableStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
}
function readableTestStatuses(value: unknown): Record<string, TestRunStatus> {
	const known = Object.entries(asRecord(value)).filter(
		(entry): entry is [string, TestRunStatus] =>
			typeof entry[1] === "string" && TEST_STATUSES.includes(entry[1]),
	);
	return Object.fromEntries(known);
}
/** Verdicts that older runs stored under another name. Before v5 a rate with no plan was "measured". */
const RENAMED_VERDICTS: Record<string, RunVerdict> = { measured: "indicative" };
function currentName(verdict: unknown): unknown {
	return typeof verdict === "string" ? (RENAMED_VERDICTS[verdict] ?? verdict) : verdict;
}
function currentNames(verdicts: unknown): unknown {
	if (typeof verdicts !== "object" || verdicts === null) return verdicts;
	return Object.fromEntries(
		Object.entries(verdicts).map(([key, value]) => [key, currentName(value)]),
	);
}
/** The stored verdict in today's names. Its exit code stays as that run reported it. */
function renamedVerdict(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	const stored = value as Record<string, unknown>;
	return {
		...stored,
		verdict: currentName(stored.verdict),
		tests: currentNames(stored.tests),
		...(stored.claimVerdicts === undefined
			? {}
			: { claimVerdicts: currentNames(stored.claimVerdicts) }),
	};
}
function readableVerdict(value: unknown): Pick<ViewerSummary, "verdict" | "verdictUnreadable"> {
	if (value === undefined) return {};
	const renamed = renamedVerdict(value);
	const verdict = storedVerdict.safeParse(renamed);
	return verdict.success ? { verdict: renamed as VerdictResult } : { verdictUnreadable: true };
}

/** A record for this run id with every field the page reads, unknown where the file gave nothing. */
export function readableSummary<T extends ExecutionSummary>(stored: T, id: string) {
	return {
		...stored,
		id,
		startedAt: readableDate(stored.startedAt),
		status: readableStatus(stored.status),
		testIds: readableStrings(stored.testIds),
		testStatuses: readableTestStatuses(stored.testStatuses),
		verdict: undefined,
		...readableVerdict(stored.verdict),
	};
}

function unknownRun(id: string): ViewerSummary {
	return {
		version: 1,
		id,
		config: "",
		startedAt: "",
		status: "unknown",
		testIds: [],
		testStatuses: {},
	};
}

async function readableRun(root: string, id: string): Promise<ViewerSummary> {
	const detail = await readExecutionDetail(join(root, id)).catch(() => undefined);
	if (!detail) return unknownRun(id);
	const { attempts: _attempts, progress: _progress, ...summary } = detail;
	return readableSummary(summary, id);
}

async function listExecutionIds(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The store skips a record it cannot parse and gives up on one it cannot sort. Show both as unknown. */
async function listTrustedSummaries(root: string): Promise<ExecutionSummary[]> {
	try {
		await recoverExecutionHistory(root);
		return await listExecutionHistory(root);
	} catch {
		return [];
	}
}

/** Newest first. Every directory in the history is a row, whatever state its record is in. */
export async function readViewerHistory(root: string): Promise<ViewerSummary[]> {
	const listed = await listTrustedSummaries(root);
	const known = new Set(listed.map(({ id }) => id));
	const others = (await listExecutionIds(root)).filter((id) => !known.has(id));
	const summaries = [
		...listed.map((summary) => readableSummary(summary, summary.id)),
		...(await Promise.all(others.map((id) => readableRun(root, id)))),
	];
	return summaries.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function claimOfStartedTest(data: Record<string, unknown>): string {
	const { title } = asRecord(data.sample);
	return claimKey({
		title: readableStrings(data.title),
		sample: typeof title === "string" ? { title } : undefined,
	});
}

/** Which claim each test id ran under. Only the journal knows, because a repeat has its own id. */
export async function readTestClaims(root: string): Promise<Record<string, string>> {
	const testClaims: Record<string, string> = {};
	for (const event of await readExecutionEvents(root).catch(() => [])) {
		const data = asRecord(asRecord(event).data);
		if (asRecord(event).type === "attempt.started" && typeof data.testId === "string")
			testClaims[data.testId] = claimOfStartedTest(data);
	}
	return testClaims;
}
