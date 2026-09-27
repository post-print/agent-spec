import { afterEach, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import { reportProgress } from "../index.js";
import {
	ExecutionStore,
	finishExecutionIfRunning,
	readExecutionDetail,
} from "../sdk/execution-store.js";
import { readExecutionProgress } from "../sdk/progress.js";

const roots: string[] = [];
const originalRoot = process.env.AGENT_TEST_EXECUTION_ROOT;
const originalId = process.env.AGENT_TEST_EXECUTION_ID;

afterEach(async () => {
	if (originalRoot === undefined) delete process.env.AGENT_TEST_EXECUTION_ROOT;
	else process.env.AGENT_TEST_EXECUTION_ROOT = originalRoot;
	if (originalId === undefined) delete process.env.AGENT_TEST_EXECUTION_ID;
	else process.env.AGENT_TEST_EXECUTION_ID = originalId;
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("reportProgress keeps concurrent tests distinct and redacts local paths", async () => {
	const root = await progressRoot("execution-concurrent");
	const first = { testId: "first", retry: 0 } as TestInfo;
	const second = { testId: "second", retry: 0 } as TestInfo;

	await Promise.all([
		reportProgress(first, { pair: 1, artifact: "/private/tmp/first/result.json" }),
		reportProgress(second, { pair: 1, note: "read /Users/person/repo/secret.txt" }),
	]);

	const progress = await readExecutionProgress(root);
	expect(progress.map(({ testId }) => testId)).toEqual(["first", "second"]);
	expect(progress.map(({ data }) => data)).toEqual([
		{ pair: 1, artifact: "<local-path>" },
		{ pair: 1, note: "read <local-path>/secret.txt" },
	]);
});

it("interrupted execution retains complete progress and ignores a partial trailing update", async () => {
	const root = await progressRoot("execution-interrupted");
	await ExecutionStore.create({ root, id: "execution-interrupted", config: "test" });
	await reportProgress({ testId: "qualification", retry: 0 } as TestInfo, {
		pair: 1,
		status: "passed",
	});
	await writeFile(join(root, "progress", "incomplete.json"), '{"version":1,"data":');
	await finishExecutionIfRunning(root, "interrupted");

	const detail = await readExecutionDetail(root);
	expect(detail?.status).toBe("interrupted");
	expect(detail?.progress).toHaveLength(1);
	expect(detail?.progress[0]).toMatchObject({
		executionId: "execution-interrupted",
		testId: "qualification",
		data: { pair: 1, status: "passed" },
	});
});

async function progressRoot(executionId: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-test-progress-"));
	roots.push(root);
	process.env.AGENT_TEST_EXECUTION_ROOT = root;
	process.env.AGENT_TEST_EXECUTION_ID = executionId;
	return root;
}

it("reportProgress persists repeated updates in call order with execution and test identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-test-progress-"));
	roots.push(root);
	process.env.AGENT_TEST_EXECUTION_ROOT = root;
	process.env.AGENT_TEST_EXECUTION_ID = "execution-1";
	const info = { testId: "qualification", retry: 2 } as TestInfo;

	await reportProgress(info, { pair: 1, status: "passed" });
	await reportProgress(info, { pair: 2, status: "failed" });

	const progress = await readExecutionProgress(root);
	expect(progress.map(({ at: _at, ...update }) => update)).toEqual([
		{
			version: 1,
			sequence: 1,
			executionId: "execution-1",
			testId: "qualification",
			attemptId: "qualification:2",
			data: { pair: 1, status: "passed" },
		},
		{
			version: 1,
			sequence: 2,
			executionId: "execution-1",
			testId: "qualification",
			attemptId: "qualification:2",
			data: { pair: 2, status: "failed" },
		},
	]);
});
