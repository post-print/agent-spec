export interface RetryOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** Retry an async operation with exponential backoff when `shouldRetry` returns true. */
export async function withRetry<T>(
	operation: (attempt: number) => Promise<T>,
	options?: RetryOptions,
): Promise<{ result: T; attempt: number }> {
	const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
	const shouldRetry = options?.shouldRetry ?? (() => false);

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const result = await operation(attempt);
			return { result, attempt };
		} catch (error) {
			lastError = error;
			if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
				throw error;
			}
			await sleep(baseDelayMs * 2 ** (attempt - 1));
		}
	}
	throw lastError;
}

/** True for transient SDK/network failures that merit a retry. */
export function isTransientInfraError(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("rate limit") ||
		lower.includes("rate_limit") ||
		lower.includes("timeout") ||
		lower.includes("timed out") ||
		lower.includes("econnreset") ||
		lower.includes("econnrefused") ||
		lower.includes("503") ||
		lower.includes("502") ||
		lower.includes("429") ||
		lower.includes("upstream") ||
		lower.includes("temporarily unavailable")
	);
}

export function resolveRetryMaxAttempts(envKey = "AGENT_TEST_LIVE_RETRIES"): number {
	const raw = process.env[envKey]?.trim();
	if (!raw) {
		return DEFAULT_MAX_ATTEMPTS;
	}
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_ATTEMPTS;
}
