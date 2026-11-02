import type { RunVerdict, VerdictResult } from "../sdk/verdict.js";

const EXPECTED_DIFF_HEADER = /^-\s+Expected\s+-\s+\d+\s*$/;
const RECEIVED_DIFF_HEADER = /^\+\s+Received\s+\+\s+\d+\s*$/;

export function stripAnsi(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) !== 27 || value[index + 1] !== "[") {
			output += value[index];
			continue;
		}
		index += 2;
		while (index < value.length) {
			const code = value.charCodeAt(index);
			if (code >= 64 && code <= 126) break;
			index++;
		}
	}
	return output;
}

export function conversationPlaceholder(status: string): string {
	return status === "running"
		? "Waiting for the first agent event…"
		: "No conversation was captured.";
}

const RUN_DATE = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/** One date style for runs everywhere: "Thu, Sep 17, 4:23 PM". */
export function formatRunDate(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Unknown date" : RUN_DATE.format(date);
}

export type TestRunStatus =
	| "queued"
	| "running"
	| "passed"
	| "failed"
	| "skipped"
	| "interrupted"
	| "flaky"
	| "no verdict"
	| "indicative"
	| "unknown";
/** What the stored verdict says, and what a test alone cannot show: the test's claim. */
export type RunSummary = {
	id: string;
	status: string;
	testIds?: string[];
	testStatuses?: Record<string, TestRunStatus>;
	verdict?: Pick<VerdictResult, "verdict" | "exitCode" | "tests" | "claims" | "claimVerdicts">;
	/** A verdict was stored but cannot be read, so nothing is known about this run. */
	verdictUnreadable?: boolean;
	/** The claim each sampled or repeated test belongs to. */
	testClaims?: Record<string, string>;
};

/** Severity order for a run inbox: what needs attention comes first. */
export const TEST_RUN_STATUS_ORDER: TestRunStatus[] = [
	"failed",
	"interrupted",
	"no verdict",
	"unknown",
	"flaky",
	"indicative",
	"running",
	"queued",
	"passed",
	"skipped",
];

/** Every verdict the CLI can reach, in the viewer's words. A new verdict will not compile until named. */
const VERDICT_STATUS: Record<RunVerdict, TestRunStatus> = {
	passed: "passed",
	indicative: "indicative",
	agent_failed: "failed",
	control_survived: "failed",
	infra_invalid: "no verdict",
	conditions_unknown: "no verdict",
	vacuous: "no verdict",
	flaky: "flaky",
	skipped_only: "skipped",
	interrupted: "interrupted",
	listed: "skipped",
	instrument_error: "no verdict",
};
/** The names a stored verdict may use. Any other name is a verdict this viewer cannot read. */
export const RUN_VERDICTS = Object.keys(VERDICT_STATUS) as [RunVerdict, ...RunVerdict[]];

function storedTestStatus(run: RunSummary, testId: string): TestRunStatus | undefined {
	const verdict = run.verdict;
	if (!verdict) return undefined;
	const test = verdict.tests[testId];
	if (test) return VERDICT_STATUS[test];
	const claimVerdict = verdict.claimVerdicts?.[run.testClaims?.[testId] ?? ""];
	if (claimVerdict) return VERDICT_STATUS[claimVerdict];
	// The verdict names every test that ran. Queued tests that never started are the only others.
	return run.testStatuses?.[testId] === "skipped" ? "skipped" : "unknown";
}

/** One test's outcome inside a run: the stored verdict when there is one, as the CLI reports it. */
export function testRunStatus(run: RunSummary, testId: string): TestRunStatus {
	if (run.verdictUnreadable) return "unknown";
	const stored = storedTestStatus(run, testId);
	if (stored) return stored;
	const recorded = run.testStatuses?.[testId];
	if (recorded) return recorded;
	if (run.status === "running") return "queued";
	if (run.status === "passed" || run.status === "failed" || run.status === "unknown")
		return run.status;
	return "interrupted";
}

/** A whole run's outcome: the stored verdict, or else the most severe test outcome. */
export function runDisplayStatus(run: RunSummary): TestRunStatus {
	if (run.verdictUnreadable || run.status === "unknown") return "unknown";
	if (run.verdict) return VERDICT_STATUS[run.verdict.verdict];
	if (run.status === "running") return "running";
	const worst = runStatusCounts(run).keys().next().value ?? "passed";
	if (run.status === "interrupted" && (worst === "passed" || worst === "skipped"))
		return "interrupted";
	return worst;
}

type AttemptOutcome = { testId?: string; retry?: number; status: string };
/**
 * What one attempt reads as. The last retry carries its test's verdict, so a control that failed
 * as it should is not red. An earlier retry and one sample of a claim report only themselves.
 */
export function attemptRunStatus(
	run: RunSummary & { attempts: AttemptOutcome[] },
	attempt: AttemptOutcome,
): string {
	if (run.verdictUnreadable) return "unknown";
	const verdict = attempt.testId ? run.verdict?.tests[attempt.testId] : undefined;
	if (!verdict) return attempt.status;
	const retriedLater = run.attempts.some(
		(other) => other.testId === attempt.testId && (other.retry ?? 0) > (attempt.retry ?? 0),
	);
	return retriedLater ? attempt.status : VERDICT_STATUS[verdict];
}

/** A status that is neither a pass nor a failure and still asks the reader to look. */
export function statusNeedsReview(status: string): boolean {
	return (
		status === "flaky" || status === "no verdict" || status === "indicative" || status === "unknown"
	);
}

/** Prefer the run where this test is active, then the newest run that actually ran it. */
export function preferredTestExecutionId(runs: RunSummary[], testId: string): string | undefined {
	const statuses = runs.map((run) => ({ id: run.id, status: testRunStatus(run, testId) }));
	const active = statuses.find(({ status }) => status === "running" || status === "queued");
	const ran = statuses.find(({ status }) => status !== "skipped");
	return active?.id ?? ran?.id ?? statuses[0]?.id;
}

export function runStatusCounts(run: RunSummary): Map<TestRunStatus, number> {
	const counts = new Map<TestRunStatus, number>();
	for (const testId of run.testIds ?? []) {
		const status = testRunStatus(run, testId);
		counts.set(status, (counts.get(status) ?? 0) + 1);
	}
	return new Map(
		TEST_RUN_STATUS_ORDER.filter((s) => counts.has(s)).map((s) => [s, counts.get(s) ?? 0]),
	);
}

/** Test ids ordered by severity, keeping run order within one status. */
export function testIdsBySeverity(run: RunSummary): string[] {
	const rank = (testId: string) => TEST_RUN_STATUS_ORDER.indexOf(testRunStatus(run, testId));
	return [...(run.testIds ?? [])].sort((left, right) => rank(left) - rank(right));
}

export type AssertionComparison = { expected: string; received: string };

export function assertionComparison(value: string): AssertionComparison | undefined {
	const lines = stripAnsi(value).split("\n");
	const expectedHeader = lines.findIndex((line) => EXPECTED_DIFF_HEADER.test(line));
	const receivedHeader = lines.findIndex((line) => RECEIVED_DIFF_HEADER.test(line));
	if (expectedHeader < 0 || receivedHeader !== expectedHeader + 1) return undefined;
	const expected: string[] = [];
	const received: string[] = [];
	for (const line of lines.slice(receivedHeader + 1)) {
		if (line.startsWith("- ")) expected.push(line.slice(2));
		if (line.startsWith("+ ")) received.push(line.slice(2));
		if (line.startsWith("  ")) {
			expected.push(line.slice(2));
			received.push(line.slice(2));
		}
	}
	return { expected: expected.join("\n"), received: received.join("\n") };
}

/** Middle value, or the mean of the two middle values; undefined for no values. */
export function median(values: number[]): number | undefined {
	if (!values.length) return undefined;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const upper = sorted[middle] ?? 0;
	return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(["'])([\s\S]*)\1$/;

/** `/bin/zsh -lc "bun test"` reads as `bun test`; the wrapper is host plumbing. */
export function unwrapShellCommand(command: string): string {
	return SHELL_WRAPPER.exec(command.trim())?.[2] ?? command;
}

type IntentSource = {
	file: string;
	title: string[];
	description?: string;
	suiteDescription?: string;
};
export type TestIntent = { suite?: string; own?: string };

/**
 * What the suite proves and what this one test adds. A description every test in its group
 * repeats is the suite's, so it is shown once instead of on every test.
 */
export function testIntent(test: IntentSource, tests: IntentSource[]): TestIntent {
	const suite = test.suiteDescription ?? sharedGroupDescription(test, tests);
	return { suite, own: test.description === suite ? undefined : test.description };
}

function sharedGroupDescription(test: IntentSource, tests: IntentSource[]): string | undefined {
	const group = tests.filter((item) => sameGroup(item, test));
	if (group.length < 2 || !test.description) return undefined;
	return group.every((item) => item.description === test.description)
		? test.description
		: undefined;
}

function sameGroup(left: IntentSource, right: IntentSource): boolean {
	return (
		left.file === right.file &&
		left.title.slice(0, -1).join("›") === right.title.slice(0, -1).join("›")
	);
}

const LONG_TEXT = 200;

/** A short size label for a judge input, so a folded field says how much it holds. */
export function describeShape(value: unknown): string {
	if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
	if (typeof value === "string") return describeText(value);
	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value).length;
		return `${keys} ${keys === 1 ? "key" : "keys"}`;
	}
	return String(value);
}

function describeText(value: string): string {
	if (value.length > LONG_TEXT) return formatBytes(new TextEncoder().encode(value).length);
	const lines = value.split("\n").length;
	return `${lines} ${lines === 1 ? "line" : "lines"}`;
}

function formatBytes(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Run length as people read it: `45s`, `5m 34s`, `1h 02m`. */
export function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

type RecordedConditions = {
	host?: string;
	confinement?: string;
	calibrated?: boolean;
	modelPinned?: boolean;
};
/** Conditions a reader must know before trusting a pass. Empty when no run recorded them. */
export function runConditionLabels(operations: { data: unknown[] }[]): string[] {
	const records = operations.flatMap(({ data }) =>
		data.flatMap((item) => {
			const record = (item as { record?: RecordedConditions } | null)?.record;
			return record ? [record] : [];
		}),
	);
	const labels = new Set<string>();
	for (const record of records) {
		if (record.confinement === "detect-only") labels.add("Unconfined");
		if (record.host !== "custom" && record.calibrated === false) labels.add("Uncalibrated");
		if (record.host !== "custom" && record.modelPinned === false) labels.add("Model unpinned");
	}
	return [...labels];
}
