/**
 * Run `items` with at most `workers` concurrent `runItem` calls.
 * Results are returned in input order.
 */
export async function runWithWorkers<T, R>(
	items: readonly T[],
	workers: number,
	runItem: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const concurrency = Math.max(1, Math.min(workers, items.length || 1));
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const index = nextIndex++;
			if (index >= items.length) {
				return;
			}
			const item = items[index];
			if (item === undefined) {
				return;
			}
			results[index] = await runItem(item, index);
		}
	}

	const pool = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(pool);
	return results;
}
