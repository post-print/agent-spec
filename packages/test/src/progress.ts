import { formatDurationLabel, theme } from "./theme.js";

const DEFAULT_HEARTBEAT_MS = 60_000;

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
	clearHeartbeatLine();
	console.log(message);
}

/** Emit a tree phase line (├─ by default; use endPhase for └─). */
export function logPhase(message: string, options?: { last?: boolean }): void {
	if (!enabled()) {
		return;
	}
	clearHeartbeatLine();
	const prefix = options?.last ? "└─" : "├─";
	console.log(theme.phaseTree(prefix, message));
}

/** Nested heartbeat / continuation under the current phase. */
export function logPhaseNested(message: string): void {
	if (!enabled()) {
		return;
	}
	clearHeartbeatLine();
	console.log(theme.phaseTree("│   ", message));
}

/** Print a verdict block (PASS/FAIL + reasons). */
export function logVerdict(lines: string[]): void {
	if (!enabled()) {
		return;
	}
	clearHeartbeatLine();
	for (const line of lines) {
		console.log(line);
	}
}

let heartbeatActive = false;

function clearHeartbeatLine(): void {
	if (!heartbeatActive || !process.stdout.isTTY) {
		return;
	}
	process.stdout.write("\r\x1b[K");
	heartbeatActive = false;
}

function writeHeartbeatOverwrite(message: string): void {
	process.stdout.write(`\r${theme.phaseTree("│   ", message)}\x1b[K`);
	heartbeatActive = true;
}

/** Log every `intervalMs` while `promise` is pending (live agent runs). */
export async function withHeartbeat<T>(
	promise: Promise<T>,
	options: { label?: string; intervalMs?: number; started?: number },
): Promise<T> {
	if (!enabled()) {
		return promise;
	}

	const started = options.started ?? performance.now();
	const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_MS;
	const useOverwrite = Boolean(process.stdout.isTTY);
	const timer = setInterval(() => {
		const elapsed = theme.duration(formatDuration(performance.now() - started));
		if (useOverwrite) {
			writeHeartbeatOverwrite(elapsed);
			return;
		}
		const label = options.label ?? "running";
		logPhaseNested(`${label}  ${elapsed}`);
	}, intervalMs);

	try {
		return await promise;
	} finally {
		clearInterval(timer);
		clearHeartbeatLine();
	}
}
