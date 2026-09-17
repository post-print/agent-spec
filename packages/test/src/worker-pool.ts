export const DEFAULT_VIEWER_WORKERS = 4;
export const DEFAULT_CLI_WORKERS = 1;
export const MAX_WORKERS = 32;

/** Parse `--workers` or `AGENT_TEST_WORKERS`. Range is 1-32. */
export function parseWorkerCount(value: string, label = "--workers"): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_WORKERS) {
		throw new Error(`${label} must be an integer 1-${MAX_WORKERS}`);
	}
	return parsed;
}

/** Run items with a fixed number of workers. Extra items wait in the queue. */
export async function runWorkerPool<T>(
	items: readonly T[],
	{
		workers,
		worker,
		signal,
	}: { workers: number; worker: (item: T) => Promise<void>; signal?: AbortSignal },
): Promise<void> {
	const queue = [...items];
	const workerCount = Math.max(1, Math.min(workers, Math.max(items.length, 1)));
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (!signal?.aborted) {
				const item = queue.shift();
				if (item === undefined) {
					return;
				}
				await worker(item);
			}
		}),
	);
}
