import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const EXECUTION_FORMAT = 1;

export type ExecutionLevel = "debug" | "info" | "warn" | "error";
export type ExecutionEvent = {
	version: typeof EXECUTION_FORMAT;
	sequence: number;
	at: string;
	type: string;
	level: ExecutionLevel;
	executionId: string;
	attemptId?: string;
	operationId?: string;
	data?: unknown;
};

export type ExecutionSummary = {
	version: typeof EXECUTION_FORMAT;
	id: string;
	config: string;
	startedAt: string;
	finishedAt?: string;
	status: "running" | "passed" | "failed" | "interrupted";
	ownerPid?: number;
	testIds?: string[];
	testStatuses?: Record<string, ExecutionTestStatus>;
};
export type ExecutionTestStatus =
	| "queued"
	| "running"
	| "passed"
	| "failed"
	| "skipped"
	| "interrupted";
export type ExecutionOperation = {
	id: string;
	kind: "agent" | "evaluation";
	name?: string;
	status: "running" | "completed" | "failed" | "interrupted";
	startedAt?: string;
	completedAt?: string;
	data: unknown[];
};
export type CriterionResult = {
	criterion: string;
	status: "passed" | "failed" | "not-recorded";
	assertion?: string;
};
export type ExecutionAttempt = {
	id: string;
	testId?: string;
	title: string[];
	project?: string;
	retry: number;
	status: "running" | "passed" | "failed" | "skipped" | "interrupted";
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	errors: unknown[];
	criterionResults: CriterionResult[];
	output: { stdout: string[]; stderr: string[] };
	operations: ExecutionOperation[];
};
export type ExecutionDetail = ExecutionSummary & { attempts: ExecutionAttempt[] };

export function executionPaths(root: string) {
	return { journal: join(root, "events.ndjson"), summary: join(root, "execution.json") };
}
export function executionHistoryRoot(config: string) {
	return join(dirname(config), ".agent-test", "executions");
}

export class ExecutionStore {
	private sequence = 0;
	private writes = Promise.resolve();
	private readonly attemptTests = new Map<string, string>();
	constructor(
		readonly root: string,
		private readonly summary: ExecutionSummary,
	) {}
	static async create(input: {
		root: string;
		id: string;
		config: string;
		ownerPid?: number;
	}): Promise<ExecutionStore> {
		const store = new ExecutionStore(input.root, {
			version: EXECUTION_FORMAT,
			id: input.id,
			config: input.config,
			startedAt: new Date().toISOString(),
			status: "running",
			ownerPid: input.ownerPid,
		});
		await mkdir(input.root, { recursive: true });
		await store.saveSummary();
		return store;
	}
	async record(input: Omit<ExecutionEvent, "version" | "sequence" | "at" | "executionId">) {
		const event: ExecutionEvent = {
			version: EXECUTION_FORMAT,
			sequence: ++this.sequence,
			at: new Date().toISOString(),
			executionId: this.summary.id,
			...input,
		};
		this.writes = this.writes.then(async () => {
			await appendFile(executionPaths(this.root).journal, `${JSON.stringify(event)}\n`);
			if (this.updateTestStatus(event)) await this.saveSummary();
		});
		await this.writes;
		return event;
	}
	async setTests(testIds: string[]) {
		this.summary.testIds = testIds;
		this.summary.testStatuses = Object.fromEntries(testIds.map((testId) => [testId, "queued"]));
		await this.saveSummary();
	}
	private updateTestStatus(event: ExecutionEvent): boolean {
		if (!event.attemptId) return false;
		if (event.type === "attempt.started") {
			const testId = asRecord(event.data).testId;
			if (typeof testId !== "string") return false;
			this.attemptTests.set(event.attemptId, testId);
			return this.setTestStatus(testId, "running");
		}
		if (event.type !== "attempt.finished") return false;
		const testId = this.attemptTests.get(event.attemptId);
		return testId ? this.setTestStatus(testId, outcomeStatus(asRecord(event.data).status)) : false;
	}
	private setTestStatus(testId: string, status: ExecutionTestStatus): boolean {
		this.summary.testStatuses = { ...this.summary.testStatuses, [testId]: status };
		return true;
	}
	async finish(status: Exclude<ExecutionSummary["status"], "running">) {
		Object.assign(this.summary, terminalSummary(this.summary, status));
		await this.saveSummary();
		await retainExecutionHistory(dirname(this.root));
	}
	private async saveSummary() {
		const target = executionPaths(this.root).summary;
		const temporary = `${target}.tmp`;
		await mkdir(dirname(target), { recursive: true });
		await writeFile(temporary, `${JSON.stringify(this.summary, null, 2)}\n`);
		await rename(temporary, target);
	}
}

export async function readExecutionEvents(root: string): Promise<ExecutionEvent[]> {
	let content: string;
	try {
		content = await readFile(executionPaths(root).journal, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return content.split("\n").flatMap((line) => {
		try {
			return line ? [JSON.parse(line) as ExecutionEvent] : [];
		} catch {
			return [];
		}
	});
}

export async function readExecutionDetail(root: string): Promise<ExecutionDetail | undefined> {
	const summary = await readExecutionSummary(root);
	if (!summary) return undefined;
	return {
		...summary,
		attempts: terminalAttempts(summary.status, summarizeAttempts(await readExecutionEvents(root))),
	};
}

function terminalAttempts(
	status: ExecutionSummary["status"],
	attempts: ExecutionAttempt[],
): ExecutionAttempt[] {
	if (status === "running") return attempts;
	const attemptStatus =
		status === "interrupted" ? "interrupted" : status === "failed" ? "failed" : "skipped";
	return attempts.map((attempt) =>
		attempt.completedAt
			? attempt
			: {
					...attempt,
					status: attemptStatus,
					operations: attempt.operations.map((operation) =>
						operation.status === "running"
							? { ...operation, status: status === "failed" ? "failed" : "interrupted" }
							: operation,
					),
				},
	);
}

function summarizeAttempts(events: ExecutionEvent[]): ExecutionAttempt[] {
	const attempts = new Map<string, ExecutionAttempt>();
	for (const event of events) {
		if (!event.attemptId) continue;
		const attempt = attempts.get(event.attemptId) ?? createAttempt(event.attemptId);
		applyAttemptEvent(attempt, event);
		attempts.set(event.attemptId, attempt);
	}
	return [...attempts.values()];
}

function createAttempt(id: string): ExecutionAttempt {
	return {
		id,
		title: [],
		retry: 0,
		status: "running",
		errors: [],
		criterionResults: [],
		output: { stdout: [], stderr: [] },
		operations: [],
	};
}

function applyAttemptEvent(attempt: ExecutionAttempt, event: ExecutionEvent): void {
	if (event.type === "attempt.started") applyAttemptStart(attempt, event);
	if (event.type === "attempt.finished") applyAttemptFinish(attempt, event);
	if (event.type === "test.stdout" || event.type === "test.stderr") addOutput(attempt, event);
	if (event.type.startsWith("operation.")) addOperationEvent(attempt, event);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function applyAttemptStart(attempt: ExecutionAttempt, event: ExecutionEvent): void {
	const data = asRecord(event.data);
	attempt.startedAt = event.at;
	attempt.testId = typeof data.testId === "string" ? data.testId : undefined;
	attempt.title = Array.isArray(data.title)
		? data.title.filter((part): part is string => typeof part === "string")
		: [];
	attempt.project = typeof data.project === "string" ? data.project : undefined;
	attempt.retry = typeof data.retry === "number" ? data.retry : 0;
}

function applyAttemptFinish(attempt: ExecutionAttempt, event: ExecutionEvent): void {
	const data = asRecord(event.data);
	attempt.completedAt = event.at;
	attempt.status = outcomeStatus(data.status);
	attempt.durationMs = typeof data.durationMs === "number" ? data.durationMs : undefined;
	attempt.errors = Array.isArray(data.errors) ? data.errors : [];
	attempt.criterionResults = parseCriterionResults(data.criterionResults);
}

function parseCriterionResults(value: unknown): CriterionResult[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = asRecord(item);
		if (typeof record.criterion !== "string") return [];
		if (
			record.status !== "passed" &&
			record.status !== "failed" &&
			record.status !== "not-recorded"
		)
			return [];
		return [
			{
				criterion: record.criterion,
				status: record.status,
				assertion: typeof record.assertion === "string" ? record.assertion : undefined,
			},
		];
	});
}

function outcomeStatus(value: unknown): ExecutionAttempt["status"] {
	if (value === "passed" || value === "failed" || value === "skipped" || value === "interrupted")
		return value;
	return "failed";
}

function addOutput(attempt: ExecutionAttempt, event: ExecutionEvent): void {
	const text = asRecord(event.data).text;
	if (typeof text === "string")
		event.type === "test.stdout"
			? attempt.output.stdout.push(text)
			: attempt.output.stderr.push(text);
}

function addOperationEvent(attempt: ExecutionAttempt, event: ExecutionEvent): void {
	if (!event.operationId) return;
	let operation = attempt.operations.find((item) => item.id === event.operationId);
	if (!operation) {
		operation = {
			id: event.operationId,
			kind: event.type.startsWith("operation.evaluation") ? "evaluation" : "agent",
			status: "running",
			startedAt: event.at,
			data: [],
		};
		attempt.operations.push(operation);
	}
	operation.data.push(event.data);
	const name = asRecord(event.data).name;
	if (typeof name === "string" && (event.type === "operation.start" || !operation.name))
		operation.name = name;
	if (event.type === "operation.complete" || event.type === "operation.evaluation") {
		operation.status = "completed";
		operation.completedAt = event.at;
	}
}

export async function listExecutionHistory(root: string): Promise<ExecutionSummary[]> {
	try {
		const entries = await readdir(root, { withFileTypes: true });
		const summaries = await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => readExecutionSummary(join(root, entry.name))),
		);
		return summaries
			.filter((summary): summary is ExecutionSummary => summary !== undefined)
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

/** Marks a process-owned execution interrupted only after its recorded process has exited. */
export async function recoverExecutionHistory(root: string): Promise<void> {
	for (const summary of await listExecutionHistory(root)) {
		if (summary.status !== "running" || !summary.ownerPid || processIsRunning(summary.ownerPid))
			continue;
		await updateExecutionSummary(join(root, summary.id), {
			...terminalSummary(summary, "interrupted"),
		});
	}
}

export async function finishExecutionIfRunning(
	root: string,
	status: Exclude<ExecutionSummary["status"], "running">,
): Promise<boolean> {
	const summary = await readExecutionSummary(root);
	if (!summary || summary.status !== "running") return false;
	await updateExecutionSummary(root, terminalSummary(summary, status));
	await retainExecutionHistory(dirname(root));
	return true;
}

async function readExecutionSummary(root: string): Promise<ExecutionSummary | undefined> {
	try {
		const summary = JSON.parse(
			await readFile(executionPaths(root).summary, "utf8"),
		) as ExecutionSummary;
		if (!summary.testIds || !summary.testStatuses) {
			const events = await readExecutionEvents(root);
			summary.testIds ??= testIdsFromEvents(events);
			summary.testStatuses ??= testStatusesFromEvents(summary.testIds, events);
		}
		return summary.status === "running" ? summary : terminalSummary(summary, summary.status);
	} catch {
		return undefined;
	}
}

function terminalSummary(
	summary: ExecutionSummary,
	status: Exclude<ExecutionSummary["status"], "running">,
): ExecutionSummary {
	const activeStatus: ExecutionTestStatus =
		status === "interrupted" ? "interrupted" : status === "failed" ? "failed" : "skipped";
	return {
		...summary,
		status,
		finishedAt: summary.finishedAt ?? new Date().toISOString(),
		testStatuses: summary.testStatuses
			? Object.fromEntries(
					Object.entries(summary.testStatuses).map(([testId, testStatus]) => [
						testId,
						testStatus === "running"
							? activeStatus
							: testStatus === "queued"
								? "skipped"
								: testStatus,
					]),
				)
			: undefined,
	};
}

function testIdsFromEvents(events: ExecutionEvent[]): string[] {
	return [
		...new Set(
			events.flatMap((event) => {
				const id = asRecord(event.data).testId;
				return event.type === "attempt.started" && typeof id === "string" ? [id] : [];
			}),
		),
	];
}

function testStatusesFromEvents(
	testIds: string[],
	events: ExecutionEvent[],
): Record<string, ExecutionTestStatus> {
	const statuses: Record<string, ExecutionTestStatus> = Object.fromEntries(
		testIds.map((testId) => [testId, "queued"]),
	);
	const attemptTests = new Map<string, string>();
	for (const event of events) applyTestStatusEvent(statuses, attemptTests, event);
	return statuses;
}

function applyTestStatusEvent(
	statuses: Record<string, ExecutionTestStatus>,
	attemptTests: Map<string, string>,
	event: ExecutionEvent,
): void {
	if (!event.attemptId) return;
	if (event.type === "attempt.started") {
		const testId = asRecord(event.data).testId;
		if (typeof testId !== "string") return;
		attemptTests.set(event.attemptId, testId);
		statuses[testId] = "running";
	}
	if (event.type !== "attempt.finished") return;
	const testId = attemptTests.get(event.attemptId);
	if (testId) statuses[testId] = outcomeStatus(asRecord(event.data).status);
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function updateExecutionSummary(root: string, summary: ExecutionSummary): Promise<void> {
	const target = executionPaths(root).summary;
	const temporary = `${target}.tmp`;
	await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`);
	await rename(temporary, target);
}

async function retainExecutionHistory(root: string, maximum = 50): Promise<void> {
	const finished = (await listExecutionHistory(root)).filter(
		(summary) => summary.status !== "running",
	);
	for (const summary of finished.slice(maximum)) {
		await rm(join(root, summary.id), { recursive: true, force: true });
	}
}
