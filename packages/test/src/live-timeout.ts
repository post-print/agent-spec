/** Default live agent deadline — long enough for slow models, short enough to fail closed. */
export const DEFAULT_LIVE_TIMEOUT_MS = 600_000;

/** Extra slack for isolated subprocess kill after the in-process harness timeout. */
export const LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS = 30_000;

/** Grace period after SIGTERM before SIGKILL on a timed-out live child. */
export const LIVE_SUBPROCESS_SIGKILL_ESCALATION_MS = 5_000;

export function resolveLiveTimeoutMs(override?: number): number | undefined {
	if (override !== undefined) {
		return override > 0 ? override : undefined;
	}

	const raw = process.env.AGENT_TEST_TIMEOUT_MS?.trim();
	if (!raw) {
		return DEFAULT_LIVE_TIMEOUT_MS;
	}
	if (raw === "0" || raw === "false") {
		return undefined;
	}

	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIVE_TIMEOUT_MS;
}

export function liveSubprocessTimeoutMs(agentTimeoutMs?: number): number | undefined {
	if (!agentTimeoutMs || agentTimeoutMs <= 0) {
		return undefined;
	}
	return agentTimeoutMs + LIVE_SUBPROCESS_TIMEOUT_BUFFER_MS;
}
