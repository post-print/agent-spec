import { basename } from "node:path";
import type { JsonValue } from "./types.js";

const PRIVATE_PATH = /\/(?:Users|home|private|tmp|var\/folders)\/[^\s"']+/g;

function redactLocalPath(value: string): string {
	return value.replace(PRIVATE_PATH, (path) => `<local-path>/${basename(path)}`);
}

export function storedValue(value: JsonValue, key?: string): JsonValue;
export function storedValue(value: unknown, key?: string): unknown;
export function storedValue(value: unknown, key?: string): unknown {
	if (typeof value === "string")
		return key === "artifact" || key === "root" ? "<local-path>" : redactLocalPath(value);
	if (Array.isArray(value)) return value.map((item) => storedValue(item, key));
	if (typeof value !== "object" || value === null) return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([entryKey, item]) => [
			entryKey,
			storedValue(item, entryKey),
		]),
	);
}
