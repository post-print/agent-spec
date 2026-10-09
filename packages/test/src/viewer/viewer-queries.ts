import { useQuery } from "@tanstack/react-query";
import { viewerApi } from "./generated-api.js";
import type { TestRunStatus } from "./presentation.js";
import type { TestCatalog } from "./test-catalog.js";

/** Run summary as the execution store and live socket publish it. */
export type ExecutionSummary = {
	id: string;
	startedAt: string;
	finishedAt?: string;
	testIds?: string[];
	status: "running" | "passed" | "failed" | "interrupted";
	testStatuses?: Record<string, TestRunStatus>;
};

export function useCatalog() {
	return useQuery({ queryKey: ["test-catalog"], queryFn: fetchTestCatalog });
}

/** Newest first; the live socket replaces this cache on every store change. */
export function useExecutionHistory() {
	return useQuery({ queryKey: ["execution-history"], queryFn: fetchExecutionHistory });
}

async function fetchTestCatalog(): Promise<TestCatalog> {
	return viewerApi.getTestCatalog();
}
async function fetchExecutionHistory(): Promise<ExecutionSummary[]> {
	return (await viewerApi.listExecutions<{ executions: ExecutionSummary[] }>()).executions;
}
export async function fetchExecution<T extends ExecutionSummary>(id: string): Promise<T> {
	return (await viewerApi.getExecution<{ execution: T }>(id)).execution;
}
export async function startTest(testId: string, workers: number): Promise<{ executionId: string }> {
	return viewerApi.startExecution(testId, workers);
}
export async function startSuite(workers: number): Promise<{ executionId: string }> {
	return viewerApi.startSuiteExecution(workers);
}
export async function startTestGroup(
	testIds: string[],
	workers: number,
): Promise<{ executionId: string }> {
	return viewerApi.startTestGroup(testIds, workers);
}
export async function cancelExecution(id: string): Promise<void> {
	await viewerApi.cancelExecution(id);
}
