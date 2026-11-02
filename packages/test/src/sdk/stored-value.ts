import { basename } from "node:path";
import { isSecretFieldName, redactSecrets } from "@post-print/agent-harness";
import type { JsonValue } from "./types.js";

const PRIVATE_PATH = /\/(?:Users|home|private|tmp|var\/folders)\/[^\s"']+/g;

function redactLocalPath(value: string): string {
	return value.replace(PRIVATE_PATH, (path) => `<local-path>/${basename(path)}`);
}

/** Base64 can contain `/tmp/`-like runs; path redaction would truncate the image. */
function isToolImage(value: object): boolean {
	const record = value as Record<string, unknown>;
	return (
		typeof record.mediaType === "string" &&
		record.mediaType.startsWith("image/") &&
		typeof record.bytes === "number" &&
		(record.data === undefined || typeof record.data === "string") &&
		Object.keys(record).every((key) => key === "mediaType" || key === "bytes" || key === "data")
	);
}

function storedString(value: string, key: string | undefined): string {
	if (key === "artifact" || key === "root") return "<local-path>";
	if (key && isSecretFieldName(key)) return "[redacted]";
	return redactLocalPath(redactSecrets(value));
}

function mapStrings(
	value: unknown,
	key: string | undefined,
	onString: (text: string, key: string | undefined) => string,
): unknown {
	if (typeof value === "string") return onString(value, key);
	if (Array.isArray(value)) return value.map((item) => mapStrings(item, key, onString));
	if (typeof value !== "object" || value === null || isToolImage(value)) return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([entryKey, item]) => [
			entryKey,
			mapStrings(item, entryKey, onString),
		]),
	);
}
export function storedValue(value: JsonValue, key?: string): JsonValue;
export function storedValue(value: unknown, key?: string): unknown;
export function storedValue(value: unknown, key?: string): unknown {
	return mapStrings(value, key, storedString);
}
/** For artifacts on this machine: secrets go, but local paths stay usable. */
export function withoutSecrets(value: unknown): unknown {
	return mapStrings(value, undefined, (text, key) =>
		key && isSecretFieldName(key) ? "[redacted]" : redactSecrets(text),
	);
}
