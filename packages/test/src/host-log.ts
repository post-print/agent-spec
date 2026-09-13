import { theme } from "./theme.js";

export type HostLogLevel = "debug" | "info" | "warn" | "error";

export interface ParsedHostLog {
	time?: string;
	level: HostLogLevel;
	service: string;
	message: string;
	meta: Record<string, string>;
}

const HOST_LOG_RE =
	/^(?:(\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\s+)?(DEBUG|INFO|WARN(?:ING)?|ERROR)\s+(\S+)\s+(.*)$/;

const HOST_NOISE_RE = /CursorRulesService|load completed meta=\{/;

const SERVICE_SHORT: Record<string, string> = {
	AgentSkillsCursorRulesService: "skills",
	LocalCursorRulesService: "project-rules",
};

let installed = false;

function normalizeLevel(raw: string): HostLogLevel {
	if (raw === "DEBUG") {
		return "debug";
	}
	if (raw === "WARN" || raw === "WARNING") {
		return "warn";
	}
	if (raw === "ERROR") {
		return "error";
	}
	return "info";
}

function parseMeta(rest: string): { message: string; meta: Record<string, string> } {
	const match = rest.match(/^(.*?)(?:\s+meta=\{(.*)\})?\s*$/);
	const message = (match?.[1] ?? rest).trim();
	const raw = match?.[2];
	const meta: Record<string, string> = {};
	if (!raw) {
		return { message, meta };
	}
	for (const part of raw.split(",")) {
		const sep = part.indexOf(":");
		if (sep === -1) {
			continue;
		}
		const key = part.slice(0, sep).trim();
		const value = part.slice(sep + 1).trim();
		if (key && value) {
			meta[key] = value;
		}
	}
	return { message, meta };
}

/** Parse a Cursor/host SDK log line. Returns undefined for agent-test output. */
export function parseHostLogLine(line: string): ParsedHostLog | undefined {
	const trimmed = line.replace(/\r$/, "").trimEnd();
	const match = trimmed.match(HOST_LOG_RE);
	if (match) {
		const { message, meta } = parseMeta(match[4] ?? "");
		return {
			time: match[1],
			level: normalizeLevel(match[2] ?? "INFO"),
			service: SERVICE_SHORT[match[3] ?? ""] ?? match[3] ?? "host",
			message,
			meta,
		};
	}
	if (HOST_NOISE_RE.test(trimmed)) {
		return { level: "info", service: "host", message: trimmed, meta: {} };
	}
	return undefined;
}

function countPhrase(
	raw: string | undefined,
	singular: string,
	plural: string,
): string | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const count = Number(raw);
	if (!Number.isFinite(count)) {
		return `${raw} ${plural}`;
	}
	return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function compactHostDetail(parsed: ParsedHostLog): string {
	const bits: string[] = [];
	if (parsed.message) {
		bits.push(parsed.message);
	}
	const duration = parsed.meta.durationMs;
	if (duration) {
		bits.push(`${duration}ms`);
	}
	const rules = countPhrase(parsed.meta.ruleCount, "rule", "rules");
	if (rules) {
		bits.push(rules);
	}
	const skills = countPhrase(parsed.meta.skillCount, "skill", "skills");
	if (skills) {
		bits.push(skills);
	}
	return bits.join(" · ");
}

export function hostLogsVerbose(): boolean {
	return (
		process.env.AGENT_TEST_DEBUG === "1" ||
		process.env.AGENT_TEST_DEBUG === "true" ||
		process.env.AGENT_TEST_VERBOSE === "1" ||
		process.env.AGENT_TEST_HOST_LOGS === "1"
	);
}

/** INFO/DEBUG stay hidden unless debug/verbose. WARN/ERROR always print. */
export function shouldPrintHostLog(level: HostLogLevel): boolean {
	if (level === "warn" || level === "error") {
		return true;
	}
	return hostLogsVerbose();
}

export function formatHostLogLine(parsed: ParsedHostLog): string {
	return theme.hostLog(parsed.level, parsed.service, compactHostDetail(parsed));
}

function rewriteChunk(text: string, pending: { value: string }): string {
	pending.value += text;
	const lines = pending.value.split("\n");
	pending.value = lines.pop() ?? "";
	const kept: string[] = [];
	for (const line of lines) {
		const parsed = parseHostLogLine(line);
		if (!parsed) {
			kept.push(line);
			continue;
		}
		if (!shouldPrintHostLog(parsed.level)) {
			continue;
		}
		kept.push(formatHostLogLine(parsed));
	}
	if (kept.length === 0) {
		return "";
	}
	return `${kept.join("\n")}\n`;
}

function patchWriteStream(stream: NodeJS.WriteStream): void {
	const original = stream.write.bind(stream);
	const pending = { value: "" };

	stream.write = ((
		chunk: string | Uint8Array,
		encoding?: BufferEncoding | ((error?: Error | null) => void),
		cb?: (error?: Error | null) => void,
	) => {
		const callback = typeof encoding === "function" ? encoding : cb;
		const enc = typeof encoding === "string" ? encoding : undefined;
		const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
		if (text.includes("\r") && !text.includes("\n")) {
			return original(chunk, enc as BufferEncoding, callback);
		}
		const rewritten = rewriteChunk(text, pending);
		if (!rewritten) {
			callback?.(null);
			return true;
		}
		return original(rewritten, enc as BufferEncoding, callback);
	}) as typeof stream.write;
}

/** Rewrite or drop host SDK logs on stdout/stderr. Safe to call more than once. */
export function installHostLogFilter(): void {
	if (installed) {
		return;
	}
	installed = true;
	patchWriteStream(process.stdout);
	patchWriteStream(process.stderr);
}
