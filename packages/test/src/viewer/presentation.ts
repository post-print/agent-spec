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

export type TestRunStatus = "queued" | "running" | "passed" | "failed" | "skipped" | "interrupted";
export type RunSummary = {
	id: string;
	status: string;
	testIds?: string[];
	testStatuses?: Record<string, TestRunStatus>;
};

/** Severity order for a run inbox: what needs attention comes first. */
export const TEST_RUN_STATUS_ORDER: TestRunStatus[] = [
	"failed",
	"interrupted",
	"running",
	"queued",
	"passed",
	"skipped",
];

/** One test's outcome inside a run. A batch status never replaces a recorded test status. */
export function testRunStatus(run: RunSummary, testId: string): TestRunStatus {
	const recorded = run.testStatuses?.[testId];
	if (recorded) return recorded;
	if (run.status === "running") return "queued";
	if (run.status === "passed" || run.status === "failed") return run.status;
	return "interrupted";
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
