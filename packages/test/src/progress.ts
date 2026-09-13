import { logger } from "@post-print/agent-harness";

import { clipToColumns, formatClock, formatDurationLabel, theme } from "./theme.js";

const DEFAULT_HEARTBEAT_MS = 60_000;
/** Tenth of a second. Faster ticks flood stdout and wrap the clock line. */
export const TTY_HEARTBEAT_MS = 100;

function enabled(): boolean {
	return process.env.AGENT_TEST_QUIET !== "1" && !process.env.VITEST;
}

export function formatDuration(ms: number): string {
	return formatDurationLabel(ms);
}

export function resolveHeartbeatInterval(isTty: boolean, overrideMs?: number): number {
	if (overrideMs !== undefined) {
		return overrideMs;
	}
	return isTty ? TTY_HEARTBEAT_MS : DEFAULT_HEARTBEAT_MS;
}

export function logProgress(message: string): void {
	if (!enabled()) {
		return;
	}
	clearHeartbeatLine();
	logger.info(message);
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

/** Durable live line (tool call) under the agent clock. */
export function logLive(message: string): void {
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
let heartbeatPaint: (() => void) | undefined;

function clearHeartbeatLine(): void {
	if (!heartbeatActive || !process.stdout.isTTY) {
		return;
	}
	process.stdout.write("\r\x1b[K");
	heartbeatActive = false;
}

function writeHeartbeatOverwrite(message: string): void {
	const columns =
		process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
	const line = clipToColumns(theme.phaseTree("│   ", message), columns);
	process.stdout.write(`\x1b[2K\r${line}`);
	heartbeatActive = true;
}

export function refreshHeartbeat(): void {
	heartbeatPaint?.();
}

/** Log every `intervalMs` while `promise` is pending (live agent runs). */
export async function withHeartbeat<T>(
	promise: Promise<T>,
	options: {
		label?: string;
		intervalMs?: number;
		started?: number;
		preview?: () => string | undefined;
	},
): Promise<T> {
	if (!enabled()) {
		return promise;
	}

	const started = options.started ?? performance.now();
	const useOverwrite = Boolean(process.stdout.isTTY);
	const intervalMs = resolveHeartbeatInterval(useOverwrite, options.intervalMs);
	const label = options.label ?? "agent";
	const paint = () => {
		const elapsed = formatClock(performance.now() - started);
		const preview = options.preview?.();
		const line = theme.agentClock(elapsed, preview);
		if (useOverwrite) {
			writeHeartbeatOverwrite(line);
			return;
		}
		logPhaseNested(theme.phase(label, theme.duration(elapsed)));
	};
	heartbeatPaint = paint;
	paint();
	const timer = setInterval(paint, intervalMs);

	try {
		return await promise;
	} finally {
		clearInterval(timer);
		if (heartbeatPaint === paint) {
			heartbeatPaint = undefined;
		}
		clearHeartbeatLine();
	}
}
