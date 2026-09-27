import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import { storedValue } from "./stored-value.js";
import type { JsonValue } from "./types.js";

export const PROGRESS_FORMAT = 1;

type StoredProgress = {
	version: typeof PROGRESS_FORMAT;
	at: string;
	executionId: string;
	testId: string;
	attemptId: string;
	data: JsonValue;
};

export type ExecutionProgress = StoredProgress & { sequence: number };

const writes = new Map<string, Promise<void>>();
let recordIndex = 0;

function progressRoot(root: string): string {
	return join(root, "progress");
}

function executionInput() {
	const root = process.env.AGENT_TEST_EXECUTION_ROOT;
	const executionId = process.env.AGENT_TEST_EXECUTION_ID;
	if (!root || !executionId)
		throw new Error("reportProgress requires an agent-test recorded execution");
	return { root, executionId };
}

/** Persists one structured progress update before the returned promise resolves. */
export async function reportProgress(info: TestInfo, data: JsonValue): Promise<void> {
	const { root, executionId } = executionInput();
	const record: StoredProgress = {
		version: PROGRESS_FORMAT,
		at: new Date().toISOString(),
		executionId,
		testId: info.testId,
		attemptId: `${info.testId}:${info.retry}`,
		data: storedValue(data),
	};
	const pending = (writes.get(root) ?? Promise.resolve()).then(async () => {
		const directory = progressRoot(root);
		const id = crypto.randomUUID();
		const name = `${Date.now()}-${process.pid}-${String(++recordIndex).padStart(8, "0")}-${id}.json`;
		const temporary = join(directory, `.${name}.tmp`);
		await mkdir(directory, { recursive: true });
		await writeFile(temporary, `${JSON.stringify(record)}\n`);
		await rename(temporary, join(directory, name));
	});
	writes.set(root, pending);
	try {
		await pending;
	} finally {
		if (writes.get(root) === pending) writes.delete(root);
	}
}

export async function readExecutionProgress(root: string): Promise<ExecutionProgress[]> {
	try {
		const entries = (await readdir(progressRoot(root), { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
			.sort((left, right) => left.name.localeCompare(right.name));
		const records = await Promise.all(
			entries.map((entry) => readProgressRecord(join(progressRoot(root), entry.name))),
		);
		return records
			.filter((record): record is StoredProgress => record !== undefined)
			.map((record, index) => ({ ...record, sequence: index + 1 }));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function readProgressRecord(path: string): Promise<StoredProgress | undefined> {
	const content = await readFile(path, "utf8");
	try {
		return JSON.parse(content) as StoredProgress;
	} catch {
		return undefined;
	}
}
