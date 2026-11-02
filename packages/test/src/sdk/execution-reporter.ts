import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestError,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { redactSecrets } from "@post-print/agent-harness";
import { stripAnsi } from "../viewer/presentation.js";
import { CHECK_OUTCOME_PREFIX, type CheckOutcome } from "./check-outcomes.js";
import { type CriterionResult, ExecutionStore } from "./execution-store.js";
import { NO_AGENT_ANNOTATION, SAMPLE_ANNOTATION } from "./sampling.js";
import { storedValue } from "./stored-value.js";

function executionInput() {
	const root = process.env.AGENT_TEST_EXECUTION_ROOT;
	const id = process.env.AGENT_TEST_EXECUTION_ID;
	const config = process.env.AGENT_TEST_EXECUTION_CONFIG;
	if (!root || !id || !config)
		throw new Error("Execution reporter requires AGENT_TEST_EXECUTION_* variables");
	return { root, id, config };
}
function attemptId(test: TestCase, result: TestResult) {
	return `${test.id}:${result.retry}`;
}
function attachmentData(result: TestResult) {
	return result.attachments.flatMap(({ name, contentType, path }) =>
		path ? [{ name, contentType, path }] : [],
	);
}
function storedErrorText(text: string | undefined): string | undefined {
	return text && redactSecrets(stripAnsi(text));
}
function errorData(result: TestResult) {
	return result.errors.map((error) => ({
		message: storedErrorText(error.message),
		stack: storedErrorText(error.stack),
	}));
}
function declaredCriteria(test: TestCase): string[] {
	const raw = test.annotations.find((entry) => entry.type === "agent-test.criteria")?.description;
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
			? parsed
			: [];
	} catch {
		return [];
	}
}
function sampleAnnotation(test: TestCase): unknown {
	const raw = test.annotations.find((entry) => entry.type === SAMPLE_ANNOTATION)?.description;
	return raw ? JSON.parse(raw) : undefined;
}
function expectationSteps(steps: TestStep[]): TestStep[] {
	return steps.flatMap((step) => [
		...(step.category === "expect" ? [step] : []),
		...expectationSteps(step.steps),
	]);
}
/** A criterion derived from an assertion with no label; only its position can find its step. */
const UNLABELLED = /^expect\b/;
function outcomeOf(criterion: string, checks: CheckOutcome[]): CriterionResult | undefined {
	const recorded = checks.filter((check) => check.criterion === criterion);
	if (recorded.length === 0) return undefined;
	return { criterion, status: recorded.every(({ passed }) => passed) ? "passed" : "failed" };
}
/**
 * Each criterion takes the outcome its own check reported. A labelled criterion whose check never ran
 * is not recorded, however the test ended. A labelled check from a helper is shown as well.
 */
function criterionData(
	test: TestCase,
	result: TestResult,
	checks: CheckOutcome[],
): CriterionResult[] {
	const assertions = expectationSteps(result.steps);
	const declared = declaredCriteria(test);
	const results = declared.map((criterion, index): CriterionResult => {
		const reported = outcomeOf(criterion, checks);
		if (reported) return reported;
		const assertion = UNLABELLED.test(criterion) ? assertions[index] : undefined;
		if (!assertion) return { criterion, status: "not-recorded" };
		return { criterion, status: assertion.error ? "failed" : "passed", assertion: assertion.title };
	});
	const undeclared = [...new Set(checks.map(({ criterion }) => criterion))].filter(
		(criterion) => !declared.includes(criterion),
	);
	return [...results, ...undeclared.flatMap((criterion) => outcomeOf(criterion, checks) ?? [])];
}
/**
 * A control earns its result on a check that failed the test after an agent started: a check the
 * test caught, or one that failed before any agent ran, shows nothing about what it is testing.
 */
function failedCheckAfterAgent(result: TestResult, agentStartedAt: number | undefined): boolean {
	if (agentStartedAt === undefined) return false;
	const reported = new Set(result.errors.map(({ message }) => message));
	return expectationSteps(result.steps).some(
		(step) =>
			step.error !== undefined &&
			reported.has(step.error.message) &&
			step.startTime.getTime() >= agentStartedAt,
	);
}
function declaresNoAgent(test: TestCase): boolean {
	return test.annotations.some(({ type }) => type === NO_AGENT_ANNOTATION);
}
type CapturedOutput = {
	stream: "stdout" | "stderr";
	chunk: string;
	test?: TestCase;
	result?: TestResult;
};

/** Records Playwright lifecycle and agent SDK events without changing terminal output. */
export default class ExecutionReporter implements Reporter {
	private readonly store = ExecutionStore.create({ ...executionInput(), ownerPid: process.pid });
	private readonly buffers = new Map<string, string>();
	/** When the first agent or judge operation of each attempt started, by the worker's clock. */
	private readonly agentStartedAt = new Map<string, number>();
	/** What each labelled check reported, by attempt. */
	private readonly checks = new Map<string, CheckOutcome[]>();
	private writes = Promise.resolve();
	private record(event: Parameters<ExecutionStore["record"]>[0]) {
		this.writes = this.writes.then(async () => {
			await (await this.store).record(event);
		});
	}
	onBegin(_config: FullConfig, suite: Suite) {
		this.writes = this.writes.then(async () => {
			await (await this.store).setTests(suite.allTests().map((test) => test.id));
		});
	}
	onTestBegin(test: TestCase, result: TestResult) {
		this.record({
			type: "attempt.started",
			level: "info",
			attemptId: attemptId(test, result),
			data: {
				testId: test.id,
				title: test.titlePath(),
				retry: result.retry,
				sample: sampleAnnotation(test),
				project: test.parent.project()?.name,
			},
		});
	}
	onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
		this.capture({ stream: "stdout", chunk: chunk.toString(), test, result });
	}
	onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
		this.capture({ stream: "stderr", chunk: chunk.toString(), test, result });
	}
	private capture(output: CapturedOutput) {
		const { chunk, test, result } = output;
		const key = test && result ? attemptId(test, result) : "global";
		const lines = `${this.buffers.get(key) ?? ""}${chunk}`.split("\n");
		this.buffers.set(key, lines.pop() ?? "");
		for (const line of lines) this.captureLine({ ...output, chunk: line });
	}
	private noteAgentStarted(attempt: string | undefined, at: number | undefined) {
		if (attempt && at !== undefined && !this.agentStartedAt.has(attempt))
			this.agentStartedAt.set(attempt, at);
	}
	private noteCheck(attempt: string, json: string) {
		try {
			const outcome = JSON.parse(json) as CheckOutcome;
			this.checks.set(attempt, [...(this.checks.get(attempt) ?? []), outcome]);
		} catch {
			this.record({ type: "recorder.parse_failed", level: "warn", attemptId: attempt, data: {} });
		}
	}
	private recordOutput(stream: CapturedOutput["stream"], line: string, attempt?: string) {
		if (!line.trim()) return;
		this.record({
			type: `test.${stream}`,
			level: stream === "stderr" ? "warn" : "info",
			attemptId: attempt,
			data: { text: redactSecrets(line) },
		});
	}
	private captureLine(output: CapturedOutput) {
		const { stream, chunk: line, test, result } = output;
		const attempt = test && result ? attemptId(test, result) : undefined;
		if (attempt && line.startsWith(CHECK_OUTCOME_PREFIX)) {
			this.noteCheck(attempt, line.slice(CHECK_OUTCOME_PREFIX.length));
			return;
		}
		if (!line.startsWith("@@agent-test:")) {
			this.recordOutput(stream, line, attempt);
			return;
		}
		try {
			const event = JSON.parse(line.slice("@@agent-test:".length)) as {
				runId: string;
				type: string;
				value: unknown;
				at?: number;
			};
			this.noteAgentStarted(attempt, event.at);
			this.record({
				type: `operation.${event.type}`,
				level: "debug",
				attemptId: attempt,
				operationId: event.runId,
				data: storedValue(event.value),
			});
		} catch {
			this.record({
				type: "recorder.parse_failed",
				level: "warn",
				attemptId: attempt,
				data: { line: redactSecrets(line) },
			});
		}
	}
	onTestEnd(test: TestCase, result: TestResult) {
		this.record({
			type: "attempt.finished",
			level: result.status === test.expectedStatus ? "info" : "error",
			attemptId: attemptId(test, result),
			data: {
				status: result.status,
				expectedStatus: test.expectedStatus,
				checkFailed: failedCheckAfterAgent(
					result,
					declaresNoAgent(test) ? 0 : this.agentStartedAt.get(attemptId(test, result)),
				),
				durationMs: result.duration,
				errors: errorData(result),
				criterionResults: criterionData(
					test,
					result,
					this.checks.get(attemptId(test, result)) ?? [],
				),
				attachments: attachmentData(result),
			},
		});
	}
	onError(error: TestError) {
		this.record({
			type: "run.error",
			level: "error",
			data: { message: storedErrorText(error.message) },
		});
	}
	async onEnd(result: FullResult) {
		await this.writes;
		await (await this.store).finish(
			result.status === "passed"
				? "passed"
				: result.status === "interrupted"
					? "interrupted"
					: "failed",
		);
	}
}
