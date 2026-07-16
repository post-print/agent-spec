/** Minimal structured logger for CLI/progress output. */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(message: string, meta?: Record<string, unknown>): void;
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
	const line = meta ? `${message} ${JSON.stringify(meta)}` : message;
	if (level === "error") {
		console.error(line);
		return;
	}
	if (level === "warn") {
		console.warn(line);
		return;
	}
	console.log(line);
}

/** Default console-backed logger used by agent-test progress output. */
export const logger: Logger = {
	debug: (message, meta) => write("debug", message, meta),
	info: (message, meta) => write("info", message, meta),
	warn: (message, meta) => write("warn", message, meta),
	error: (message, meta) => write("error", message, meta),
};
