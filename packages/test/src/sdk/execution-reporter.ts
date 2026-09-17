import { basename } from "node:path";
import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
	TestStep,
} from "@playwright/test/reporter";
import { stripAnsi } from "../viewer/presentation.js";
import { type CriterionResult, ExecutionStore } from "./execution-store.js";

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
function errorData(result: TestResult) {
	return result.errors.map((error) => ({
		message: error.message ? stripAnsi(error.message) : error.message,
		stack: error.stack ? stripAnsi(error.stack) : error.stack,
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
function expectationSteps(steps: TestStep[]): TestStep[] {
	return steps.flatMap((step) => [
		...(step.category === "expect" ? [step] : []),
		...expectationSteps(step.steps),
	]);
}
function criterionData(test: TestCase, result: TestResult): CriterionResult[] {
	const assertions = expectationSteps(result.steps);
	const criteria = declaredCriteria(test);
	return criteria.map((criterion, index) => {
		const assertion = assertions[index];
		if (!assertion)
			return {
				criterion,
				status: result.status === "passed" ? "passed" : "not-recorded",
			};
		return {
			criterion,
			status: assertion?.error ? "failed" : "passed",
			assertion: assertion?.title,
		};
	});
}
type CapturedOutput = {
	stream: "stdout" | "stderr";
	chunk: string;
	test?: TestCase;
	result?: TestResult;
};

const PRIVATE_PATH = /\/(?:Users|home|private|tmp|var\/folders)\/[^\s"']+/g;

function redactLocalPath(value: string): string {
	return value.replace(PRIVATE_PATH, (path) => `<local-path>/${basename(path)}`);
}

export function storedValue(value: unknown, key?: string): unknown {
	if (typeof value === "string")
		return key === "artifact" || key === "root" ? "<local-path>" : redactLocalPath(value);
	if (Array.isArray(value)) return value.map((item) => storedValue(item, key));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([entryKey, item]) => [
			entryKey,
			storedValue(item, entryKey),
		]),
	);
}

/** Records Playwright lifecycle and agent SDK events without changing terminal output. */
export default class ExecutionReporter implements Reporter {
	private readonly store = ExecutionStore.create({ ...executionInput(), ownerPid: process.pid });
	private readonly buffers = new Map<string, string>();
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
	private captureLine(output: CapturedOutput) {
		const { stream, chunk: line, test, result } = output;
		const attempt = test && result ? attemptId(test, result) : undefined;
		if (!line.startsWith("@@agent-test:")) {
			if (line.trim())
				this.record({
					type: `test.${stream}`,
					level: stream === "stderr" ? "warn" : "info",
					attemptId: attempt,
					data: { text: line },
				});
			return;
		}
		try {
			const event = JSON.parse(line.slice("@@agent-test:".length)) as {
				runId: string;
				type: string;
				value: unknown;
			};
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
				data: { line },
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
				durationMs: result.duration,
				errors: errorData(result),
				criterionResults: criterionData(test, result),
			},
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
