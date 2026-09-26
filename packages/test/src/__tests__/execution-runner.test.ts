import { afterEach, expect, it } from "bun:test";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startRecordedExecution } from "../sdk/execution-runner.js";
import {
	ExecutionStore,
	executionHistoryRoot,
	listExecutionHistory,
	readExecutionDetail,
} from "../sdk/execution-store.js";

const config = fileURLToPath(
	new URL("../../fixtures/execution-runner/agent-test.config.ts", import.meta.url),
);
const timeoutConfig = fileURLToPath(
	new URL("../../fixtures/execution-timeout/agent-test.config.ts", import.meta.url),
);
const stalledBuiltin = fileURLToPath(
	new URL("../../../harness/src/__tests__/fixtures/fake-codex-hang.mjs", import.meta.url),
);
const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("cancel finishes the durable execution as interrupted", async () => {
	const execution = await startRecordedExecution({
		config,
		args: ["--grep", "pending work can be cancelled", "--workers", "1"],
	});
	const root = join(executionHistoryRoot(config), execution.id);
	roots.push(root);
	await waitForAttempt(root);
	execution.cancel();
	expect(await completesWithin(execution.completed, 5_000)).toBe(true);
	const detail = await readExecutionDetail(root);
	expect(detail?.status).toBe("interrupted");
	expect(detail?.testIds).toHaveLength(1);
});

it("records completed criterion assertions before later assertions are skipped", async () => {
	const execution = await startRecordedExecution({
		config,
		args: ["--grep", "records the failed criterion", "--workers", "1"],
	});
	const root = join(executionHistoryRoot(config), execution.id);
	roots.push(root);
	await execution.completed;
	const detail = await readExecutionDetail(root);
	expect(detail?.attempts[0]?.criterionResults).toEqual([
		{ criterion: "The value matches.", status: "failed", assertion: 'Expect "toBe"' },
		{ criterion: "The file is read.", status: "not-recorded" },
		{ criterion: "The tool runs.", status: "not-recorded" },
	]);
});

it("isolates Playwright output for overlapping executions", async () => {
	const args = ["--grep", "keeps an attachment", "--workers", "1"];
	const first = await startRecordedExecution({ config, args });
	const second = await startRecordedExecution({ config, args });
	const firstRoot = join(executionHistoryRoot(config), first.id);
	const secondRoot = join(executionHistoryRoot(config), second.id);
	roots.push(firstRoot, secondRoot);

	expect(await Promise.all([first.completed, second.completed])).toEqual([0, 0]);
	expect((await readExecutionDetail(firstRoot))?.status).toBe("passed");
	expect((await readExecutionDetail(secondRoot))?.status).toBe("passed");
});

it("records a stalled builtin as a terminal infrastructure failure", async () => {
	await chmod(stalledBuiltin, 0o755);
	const previousBin = process.env.CODEX_BIN;
	process.env.CODEX_BIN = stalledBuiltin;
	const execution = await startRecordedExecution({
		config: timeoutConfig,
		args: ["--workers", "1"],
	});
	if (previousBin === undefined) delete process.env.CODEX_BIN;
	else process.env.CODEX_BIN = previousBin;
	const root = join(executionHistoryRoot(timeoutConfig), execution.id);
	roots.push(root);

	expect(await completesWithin(execution.completed, 5_000)).toBe(true);
	const detail = await readExecutionDetail(root);
	expect(detail?.status).toBe("failed");
	expect(detail?.finishedAt).toBeDefined();
	expect(detail?.attempts[0]?.operations[0]).toMatchObject({
		status: "failed",
		data: expect.arrayContaining([
			expect.objectContaining({ kind: "infrastructure", code: "timeout", timeoutMs: 75 }),
		]),
	});
});

it("recovers dead-owner executions before starting another recorded run", async () => {
	const orphanId = `orphan-${crypto.randomUUID()}`;
	const orphanRoot = join(executionHistoryRoot(config), orphanId);
	await ExecutionStore.create({
		root: orphanRoot,
		id: orphanId,
		config,
		ownerPid: 999_999,
	});
	roots.push(orphanRoot);

	const execution = await startRecordedExecution({
		config,
		args: ["--grep", "keeps an attachment", "--workers", "1"],
	});
	roots.push(join(executionHistoryRoot(config), execution.id));
	await execution.completed;

	const orphan = (await listExecutionHistory(executionHistoryRoot(config))).find(
		(summary) => summary.id === orphanId,
	);
	expect(orphan?.status).toBe("interrupted");
	expect(orphan?.finishedAt).toBeDefined();
});

async function completesWithin(completed: Promise<number>, milliseconds: number): Promise<boolean> {
	return Promise.race([
		completed.then(() => true),
		new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), milliseconds)),
	]);
}

async function waitForAttempt(root: string): Promise<void> {
	for (let tries = 0; tries < 100; tries++) {
		if ((await readExecutionDetail(root))?.attempts.length) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 25));
	}
	throw new Error("The fixture did not start its first attempt");
}
