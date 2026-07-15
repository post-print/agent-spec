import { formatDurationLabel, theme } from "./theme.js";

function enabled(): boolean {
	return process.env.AGENT_TEST_QUIET !== "1" && !process.env.VITEST;
}

export function formatDuration(ms: number): string {
	return formatDurationLabel(ms);
}

export function logProgress(message: string): void {
	if (!enabled()) {
		return;
	}
	console.log(message);
}

/** Emit a tree phase line (├─ by default; use endPhase for └─). */
export function logPhase(message: string, options?: { last?: boolean }): void {
	if (!enabled()) {
		return;
	}
	const prefix = options?.last ? "└─" : "├─";
	console.log(theme.phaseTree(prefix, message));
}

/** Nested heartbeat / continuation under the current phase. */
export function logPhaseNested(message: string): void {
	if (!enabled()) {
		return;
	}
	console.log(theme.phaseTree("│   ", message));
}

/** Print a verdict block (PASS/FAIL + reasons). */
export function logVerdict(lines: string[]): void {
	if (!enabled()) {
		return;
	}
	for (const line of lines) {
		console.log(line);
	}
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
		logPhaseNested(
			`${options.label} … ${theme.duration(formatDuration(performance.now() - started))}`,
		);
	}, intervalMs);

	try {
		return await promise;
	} finally {
		clearInterval(timer);
	}
}
