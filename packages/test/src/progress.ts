function enabled(): boolean {
	return process.env.AGENT_TEST_QUIET !== "1" && !process.env.VITEST;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

export function logProgress(message: string): void {
	if (!enabled()) {
		return;
	}
	console.log(message);
}

export function logPhase(message: string): void {
	if (!enabled()) {
		return;
	}
	console.log(`  ${message}`);
}

/** Log every `intervalMs` while `promise` is pending (live agent runs). */
export async function withHeartbeat<T>(
	promise: Promise<T>,
	options: { label: string; intervalMs?: number; started?: number },
): Promise<T> {
	if (!enabled()) {
		return promise;
	}

	const started = options.started ?? performance.now();
	const intervalMs = options.intervalMs ?? 30_000;
	const timer = setInterval(() => {
		logPhase(`${options.label} … ${formatDuration(performance.now() - started)} elapsed`);
	}, intervalMs);

	try {
		return await promise;
	} finally {
		clearInterval(timer);
	}
}
