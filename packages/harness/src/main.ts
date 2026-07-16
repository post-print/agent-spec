/** Readiness probe path for CLI/package diagnostics. */
export const HEALTH_CHECK_PATH = "/health";

export interface HealthStatus {
	ok: boolean;
	path: typeof HEALTH_CHECK_PATH;
}

/** Lightweight health signal for agent-spec packages (used by agent-test --doctor). */
export function getHealthStatus(): HealthStatus {
	return { ok: true, path: HEALTH_CHECK_PATH };
}
