import { expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ExecutionStore,
	listExecutionHistory,
	readExecutionDetail,
	readExecutionEvents,
	recoverExecutionHistory,
} from "../sdk/execution-store.js";

it("execution store › persists ordered events and terminal state", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-execution-"));
	try {
		const store = await ExecutionStore.create({
			root,
			id: "run-1",
			config: "/repo/agent-test.config.ts",
		});
		await store.record({ type: "attempt.started", level: "info", attemptId: "attempt-1" });
		await store.record({
			type: "agent.text",
			level: "debug",
			attemptId: "attempt-1",
			operationId: "agent-1",
		});
		await store.finish("passed");
		const events = await readExecutionEvents(root);
		expect(events.map((event) => event.sequence)).toEqual([1, 2]);
		expect(events[1]?.operationId).toBe("agent-1");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › groups attempts with their named operations", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-detail-"));
	try {
		const store = await ExecutionStore.create({
			root,
			id: "run-1",
			config: "/repo/agent-test.config.ts",
		});
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "attempt-1",
			data: { title: ["suite", "writes a file"], project: "openai", retry: 0 },
		});
		await store.record({
			type: "operation.complete",
			level: "debug",
			attemptId: "attempt-1",
			operationId: "agent-1",
			data: { name: "writer", output: "done" },
		});
		await store.record({
			type: "attempt.finished",
			level: "info",
			attemptId: "attempt-1",
			data: { status: "passed", durationMs: 12, errors: [] },
		});
		const detail = await readExecutionDetail(root);
		expect(detail?.attempts[0]).toMatchObject({
			title: ["suite", "writes a file"],
			project: "openai",
			status: "passed",
			operations: [{ name: "writer", kind: "agent", status: "completed" }],
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › orders concurrent operations by invocation index", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-operation-order-"));
	try {
		const store = await ExecutionStore.create({ root, id: "run-1", config: "test" });
		const event = { level: "debug" as const, attemptId: "attempt-1" };
		await store.record({
			...event,
			type: "operation.start",
			operationId: "agent-2",
			data: { name: "agent", invocationIndex: 1 },
		});
		await store.record({
			...event,
			type: "operation.start",
			operationId: "agent-1",
			data: { name: "agent", invocationIndex: 0 },
		});
		const operations = (await readExecutionDetail(root))?.attempts[0]?.operations;
		expect(operations?.map((operation) => operation.id)).toEqual(["agent-1", "agent-2"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › keeps the agent name when tool events arrive", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-operation-name-"));
	try {
		const store = await ExecutionStore.create({ root, id: "run-1", config: "test" });
		const event = { level: "debug" as const, attemptId: "attempt-1", operationId: "agent-1" };
		await store.record({
			...event,
			type: "operation.start",
			data: { name: "seeded" },
		});
		await store.record({
			...event,
			type: "operation.agent",
			data: { type: "tool", name: "Read" },
		});
		const detail = await readExecutionDetail(root);
		expect(detail?.attempts[0]?.operations[0]?.name).toBe("seeded");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › keeps a judge operation running until its evaluation arrives", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-judge-operation-"));
	try {
		const store = await ExecutionStore.create({ root, id: "run-1", config: "test" });
		const event = { level: "debug" as const, attemptId: "attempt-1", operationId: "judge-1" };
		await store.record({
			...event,
			type: "operation.evaluation-start",
			data: {
				name: "releaseAdvice",
				evaluation: { prompt: "Should this release proceed?" },
			},
		});
		expect((await readExecutionDetail(root))?.attempts[0]?.operations).toEqual([
			expect.objectContaining({
				id: "judge-1",
				kind: "evaluation",
				name: "releaseAdvice",
				status: "running",
			}),
		]);

		await store.record({
			...event,
			type: "operation.evaluation",
			data: { name: "releaseAdvice", output: { safe: true } },
		});
		expect((await readExecutionDetail(root))?.attempts[0]?.operations).toEqual([
			expect.objectContaining({
				id: "judge-1",
				kind: "evaluation",
				status: "completed",
			}),
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › retains the newest fifty completed executions", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-history-"));
	try {
		for (let index = 0; index < 51; index++) {
			const store = await ExecutionStore.create({
				root: join(root, `run-${index}`),
				id: `run-${index}`,
				config: "/repo/agent-test.config.ts",
			});
			await store.finish("passed");
		}
		expect(await listExecutionHistory(root)).toHaveLength(50);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution store › recovers an orphaned process-owned execution", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-recovery-"));
	try {
		await ExecutionStore.create({
			root: join(root, "orphan"),
			id: "orphan",
			config: "test",
			ownerPid: 999_999,
		});
		await recoverExecutionHistory(root);
		expect((await listExecutionHistory(root))[0]?.status).toBe("interrupted");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution history associates existing and new records with their tests", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-association-"));
	try {
		const store = await ExecutionStore.create({
			root: join(root, "old"),
			id: "old",
			config: "test",
		});
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "a",
			data: { testId: "first" },
		});
		expect((await listExecutionHistory(root))[0]?.testIds).toEqual(["first"]);
		await store.setTests(["first", "second"]);
		expect((await listExecutionHistory(root))[0]?.testIds).toEqual(["first", "second"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("execution history tracks each queued, running, and completed test independently", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-statuses-"));
	try {
		const store = await ExecutionStore.create({
			root: join(root, "run"),
			id: "run",
			config: "test",
		});
		await store.setTests(["passed", "active", "queued"]);
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "passed:0",
			data: { testId: "passed" },
		});
		await store.record({
			type: "attempt.finished",
			level: "info",
			attemptId: "passed:0",
			data: { status: "passed" },
		});
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "active:0",
			data: { testId: "active" },
		});
		expect((await listExecutionHistory(root))[0]?.testStatuses).toEqual({
			passed: "passed",
			active: "running",
			queued: "queued",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("terminal execution state clears unfinished test, attempt, and operation activity", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-terminal-statuses-"));
	try {
		const runRoot = join(root, "run");
		const store = await ExecutionStore.create({ root: runRoot, id: "run", config: "test" });
		await store.setTests(["active", "queued"]);
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "active:0",
			data: { testId: "active" },
		});
		await store.record({
			type: "operation.start",
			level: "debug",
			attemptId: "active:0",
			operationId: "agent-1",
			data: { name: "agent" },
		});
		await store.finish("interrupted");

		expect((await listExecutionHistory(root))[0]?.testStatuses).toEqual({
			active: "interrupted",
			queued: "skipped",
		});
		expect((await readExecutionDetail(runRoot))?.attempts[0]).toMatchObject({
			status: "interrupted",
			operations: [{ status: "interrupted" }],
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("derives per-test statuses from journals written before status tracking", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-legacy-statuses-"));
	try {
		const store = await ExecutionStore.create({
			root: join(root, "run"),
			id: "run",
			config: "test",
		});
		await store.setTests(["passed", "active", "queued"]);
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "passed:0",
			data: { testId: "passed" },
		});
		await store.record({
			type: "attempt.finished",
			level: "info",
			attemptId: "passed:0",
			data: { status: "passed" },
		});
		await store.record({
			type: "attempt.started",
			level: "info",
			attemptId: "active:0",
			data: { testId: "active" },
		});
		const summaryPath = join(root, "run", "execution.json");
		const summary = JSON.parse(await readFile(summaryPath, "utf8")) as Record<string, unknown>;
		const { testStatuses: _testStatuses, ...legacySummary } = summary;
		await writeFile(summaryPath, `${JSON.stringify(legacySummary)}\n`);
		expect((await listExecutionHistory(root))[0]?.testStatuses).toEqual({
			passed: "passed",
			active: "running",
			queued: "queued",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
