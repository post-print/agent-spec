/** Soft recommendation for live subprocess concurrency (memory / OOM). */
export const LIVE_WORKERS_SOFT_CAP = 4;

export interface NormalizeWorkersInput {
	requested?: number;
	scenarioCount: number;
	recordFixtures?: boolean;
	worktree?: boolean;
	/** True when AGENT_TEST_NO_ISOLATE disables subprocess isolation. */
	isolateDisabled?: boolean;
	scenarioFilter?: string;
	isLive?: boolean;
	/** Emit clamp warnings (default true). */
	warn?: (message: string) => void;
}

/**
 * Resolve effective worker count. Default 1. Clamps to scenario count and
 * forces 1 when concurrency is unsafe (fixtures, no-worktree, no-isolate, filter).
 */
export function normalizeWorkers(input: NormalizeWorkersInput): number {
	const warn = input.warn ?? ((message: string) => console.warn(message));
	const scenarioCount = Math.max(0, input.scenarioCount);
	if (scenarioCount === 0) {
		return 1;
	}

	let workers =
		input.requested !== undefined && Number.isInteger(input.requested) && input.requested >= 1
			? input.requested
			: 1;

	const reasons: string[] = [];
	if (input.recordFixtures) {
		reasons.push("--record-fixtures");
	}
	if (input.worktree === false || envTruthy(process.env.AGENT_TEST_NO_WORKTREE)) {
		reasons.push("--no-worktree / AGENT_TEST_NO_WORKTREE");
	}
	if (input.isolateDisabled) {
		reasons.push("AGENT_TEST_NO_ISOLATE");
	}
	if (input.scenarioFilter) {
		reasons.push("--scenario");
	}

	if (reasons.length > 0 && workers > 1) {
		warn(`agent-test: workers clamped to 1 (${reasons.join(", ")})`);
		workers = 1;
	}

	if (workers > scenarioCount) {
		workers = scenarioCount;
	}

	if (input.isLive && workers > LIVE_WORKERS_SOFT_CAP) {
		warn(
			`agent-test: --workers ${workers} exceeds soft live cap ${LIVE_WORKERS_SOFT_CAP} (macOS OOM / exit 137 risk)`,
		);
	}

	return workers;
}

function envTruthy(value: string | undefined): boolean {
	return value === "1" || value === "true";
}

/** Parse `--workers N` / env value; throws on invalid input. */
export function parseWorkersFlag(raw: string, source: string): number {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${source} requires an integer >= 1 (got ${JSON.stringify(raw)})`);
	}
	return parsed;
}
