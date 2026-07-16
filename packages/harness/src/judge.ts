import { runJudgeClassifier } from "./cursor-run.js";
import type { AgentTrace } from "./types.js";

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/;

export interface JudgeCriterion {
	id: string;
	question: string;
}

export interface JudgeVerdict {
	id: string;
	pass: boolean;
	rationale: string;
	evidence?: string[];
	/** Present when the judge SDK run failed (distinct from a criterion miss). */
	infraError?: string;
	/** Unnormalized SDK status when the judge run did not finish. */
	rawSdkStatus?: string;
	sdkError?: { message?: string; code?: string };
	/** Attempt number (1 until retries land). */
	attempt?: number;
	/** Wall time for this judge criterion call (ms). */
	durationMs?: number;
	transcriptChars?: number;
	promptChars?: number;
}

export interface JudgeTraceOptions {
	cwd: string;
	apiKey?: string;
}

export interface JudgeTraceResult {
	verdicts: JudgeVerdict[];
	skipped: boolean;
	error?: string;
}

export interface ParsedJudgeJson {
	pass: boolean;
	rationale: string;
	evidence: string[];
	valid: boolean;
}

function transcriptForJudge(trace: AgentTrace): string {
	return [
		...trace.messages.map((m) => m.content),
		trace.prBody ?? "",
		trace.gitDiff ? `Git diff:\n${trace.gitDiff}` : "",
		trace.shellCommands.length > 0 ? `Shell commands:\n${trace.shellCommands.join("\n")}` : "",
	]
		.filter(Boolean)
		.join("\n\n---\n\n");
}

function normalizeVerdict(value: unknown): "yes" | "no" | undefined {
	const verdict = String(value ?? "")
		.trim()
		.toLowerCase();
	if (verdict === "yes" || verdict === "no") {
		return verdict;
	}
	return undefined;
}

type JudgeJsonParseAttempt = {
	result: ParsedJudgeJson;
	/**
	 * True when the reply is a JSON contract attempt (successfully parsed
	 * object/array, or truncated/unparseable JSON-shaped text). Callers must
	 * not fall back to YES/NO prose salvage in that case.
	 */
	structured: boolean;
};

const JUDGE_JSON_FENCE_OPEN_PATTERN = /```(?:json)?\b/i;
const JUDGE_JSON_VERDICT_KEY_PATTERN = /"verdict"\s*:/;

/** Detect JSON-contract attempts that failed to parse (truncated objects, etc.). */
function looksLikeJudgeJsonAttempt(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return true;
	}
	if (JUDGE_JSON_FENCE_OPEN_PATTERN.test(trimmed)) {
		return true;
	}
	return JUDGE_JSON_VERDICT_KEY_PATTERN.test(trimmed);
}

/**
 * True when the JSON contract body is array-shaped (`[` before any `{`),
 * including truncated arrays. Object-extraction must not peel an inner
 * `{…}` out of those replies.
 */
function isArrayShapedJudgeJson(text: string): boolean {
	const trimmed = text.trim();
	const fenced = trimmed.match(JSON_FENCE_PATTERN);
	const body = fenced?.[1]?.trim() ?? trimmed;
	const bracket = body.indexOf("[");
	if (bracket === -1) {
		return false;
	}
	const brace = body.indexOf("{");
	return brace === -1 || bracket < brace;
}

const INVALID_JUDGE_JSON: ParsedJudgeJson = {
	pass: false,
	rationale: "judge returned invalid JSON (expected { verdict, evidence, rationale })",
	evidence: [],
	valid: false,
};

/**
 * Try structured judge JSON. `structured` is set when any candidate parsed as an
 * object/array, or when the text still looks like a JSON contract attempt —
 * callers must not fall back to YES/NO prose salvage in that case.
 */
function tryParseJudgeJson(text: string): JudgeJsonParseAttempt {
	const trimmed = text.trim();
	const candidates = [trimmed];

	const fenced = trimmed.match(JSON_FENCE_PATTERN);
	if (fenced?.[1]) {
		candidates.unshift(fenced[1].trim());
	}

	// Prose-prefixed single objects may still use greedy `{…}` extraction.
	// Array-shaped replies (including truncated `[{…}`) must not.
	if (!isArrayShapedJudgeJson(trimmed)) {
		const objectMatch = trimmed.match(JSON_OBJECT_PATTERN);
		if (objectMatch?.[0]) {
			candidates.push(objectMatch[0]);
		}
	}

	let structured = false;
	for (const candidate of candidates) {
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (parsed === null || typeof parsed !== "object") {
				continue;
			}
			structured = true;
			if (Array.isArray(parsed)) {
				return { result: { ...INVALID_JUDGE_JSON }, structured: true };
			}
			const record = parsed as Record<string, unknown>;
			const verdict = normalizeVerdict(record.verdict);
			if (verdict !== undefined) {
				return {
					result: {
						pass: verdict === "yes",
						rationale: String(record.rationale ?? "").trim() || "no rationale",
						evidence: Array.isArray(record.evidence)
							? record.evidence.map((item) => String(item)).filter(Boolean)
							: [],
						valid: true,
					},
					structured: true,
				};
			}
		} catch {
			// try next candidate
		}
	}

	return {
		result: { ...INVALID_JUDGE_JSON },
		structured: structured || looksLikeJudgeJsonAttempt(trimmed),
	};
}

/** Parse structured judge JSON (`verdict`, `evidence`, `rationale`). */
export function parseJudgeJsonResponse(text: string): ParsedJudgeJson {
	return tryParseJudgeJson(text).result;
}

const JUDGE_MARKDOWN_TRIM_PATTERN = /^\*+\s*|\s*\*+$/g;
const JUDGE_VERDICT_PREFIX_PATTERN = /^(?:answer|verdict|line\s*1)\s*:\s*/i;
const JUDGE_TRAILING_PUNCT_PATTERN = /[.:!]+$/g;
const JUDGE_TAIL_VERDICT_PATTERN = /\b(YES|NO)\.?\s*$/i;
const JUDGE_INLINE_VERDICT_PATTERN = /\b(YES|NO)\b/i;

function extractLegacyVerdict(line: string): "yes" | "no" | undefined {
	const stripped = line
		.replace(JUDGE_MARKDOWN_TRIM_PATTERN, "")
		.replace(JUDGE_VERDICT_PREFIX_PATTERN, "")
		.trim();
	const head = stripped.replace(JUDGE_TRAILING_PUNCT_PATTERN, "").toUpperCase();
	if (head === "YES" || head.startsWith("YES ")) {
		return "yes";
	}
	if (head === "NO" || head.startsWith("NO ")) {
		return "no";
	}
	const tailMatch = stripped.match(JUDGE_TAIL_VERDICT_PATTERN);
	if (tailMatch?.[1]) {
		return tailMatch[1].toLowerCase() as "yes" | "no";
	}
	const inlineMatch = stripped.match(JUDGE_INLINE_VERDICT_PATTERN);
	if (inlineMatch?.[1]) {
		return inlineMatch[1].toLowerCase() as "yes" | "no";
	}
	return undefined;
}

/** Fallback when model ignores JSON contract — parse YES/NO prose. */
export function parseJudgeLegacyResponse(text: string): ParsedJudgeJson {
	const lines = text
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	for (let index = 0; index < Math.min(lines.length, 3); index++) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const verdict = extractLegacyVerdict(line);
		if (verdict !== undefined) {
			const rationale =
				lines
					.filter((_, i) => i !== index)
					.join(" ")
					.trim() || line.replace(JUDGE_TAIL_VERDICT_PATTERN, "").trim();
			return {
				pass: verdict === "yes",
				rationale: rationale || line,
				evidence: [],
				valid: true,
			};
		}
	}

	const fallback = extractLegacyVerdict(lines[0] ?? text.trim());
	if (fallback !== undefined) {
		return {
			pass: fallback === "yes",
			rationale: lines.slice(1).join(" ").trim() || lines[0] || text,
			evidence: [],
			valid: true,
		};
	}

	return {
		pass: false,
		rationale: "judge returned invalid JSON (expected { verdict, evidence, rationale })",
		evidence: [],
		valid: false,
	};
}

/**
 * Parse structured JSON first, then legacy YES/NO prose.
 * Once a JSON contract attempt is detected (parsed object/array or truncated
 * JSON-shaped text), never salvage YES/NO from the body — invalid contracts
 * are infra failures, not rubric answers.
 */
export function parseJudgeResponse(text: string): ParsedJudgeJson {
	const { result, structured } = tryParseJudgeJson(text);
	if (result.valid || structured) {
		return result;
	}
	return parseJudgeLegacyResponse(text);
}

function buildJudgePrompt(transcript: string, question: string): string {
	return [
		"You are a test harness classifier. Do not use tools. Do not edit files.",
		"Decide whether the transcript satisfies the criterion using only transcript evidence.",
		"Reply with one JSON object only — no markdown fences, no text before or after:",
		'{"verdict":"yes"|"no","evidence":["verbatim quote from transcript"],"rationale":"one sentence"}',
		'Use verdict "yes" only when evidence clearly supports the criterion.',
		"",
		"Transcript:",
		transcript,
		"",
		`Criterion: ${question}`,
	].join("\n");
}

function formatJudgeInfraError(result: {
	status: string;
	rawStatus?: string;
	sdkError?: { message?: string; code?: string };
}): string {
	const details: string[] = [];
	if (result.rawStatus) {
		details.push(`sdk: ${result.rawStatus}`);
	}
	if (result.sdkError?.code) {
		details.push(`code: ${result.sdkError.code}`);
	}
	if (result.sdkError?.message) {
		details.push(`error: ${result.sdkError.message}`);
	}
	if (details.length === 0) {
		return `judge run status: ${result.status}`;
	}
	return `judge run status: ${result.status} (${details.join(", ")})`;
}

async function runJudgePrompt(
	prompt: string,
	options: JudgeTraceOptions,
): Promise<{
	pass: boolean;
	rationale: string;
	evidence: string[];
	error?: string;
	infraError?: string;
	rawSdkStatus?: string;
	sdkError?: { message?: string; code?: string };
	durationMs: number;
}> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		return {
			pass: false,
			rationale: "CURSOR_API_KEY not set",
			evidence: [],
			error: "missing api key",
			infraError: "missing api key",
			durationMs: 0,
		};
	}

	const started = performance.now();
	try {
		const result = await runJudgeClassifier({
			cwd: options.cwd,
			prompt,
			apiKey,
		});
		const durationMs = Math.round(performance.now() - started);
		if (result.status !== "completed") {
			const infraError = formatJudgeInfraError(result);
			return {
				pass: false,
				rationale: infraError,
				evidence: [],
				error: infraError,
				infraError,
				rawSdkStatus: result.rawStatus ?? result.status,
				sdkError: result.sdkError,
				durationMs,
			};
		}
		const parsed = parseJudgeResponse(result.text);
		if (!parsed.valid) {
			const rationale = `${parsed.rationale} (raw: ${result.text.slice(0, 160) || "empty"})`;
			return {
				pass: false,
				rationale,
				evidence: [],
				error: rationale,
				infraError: rationale,
				durationMs,
			};
		}
		return {
			pass: parsed.pass,
			rationale: parsed.rationale,
			evidence: parsed.evidence,
			durationMs,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "judge prompt failed";
		return {
			pass: false,
			rationale: message,
			evidence: [],
			error: message,
			infraError: message,
			durationMs: Math.round(performance.now() - started),
		};
	}
}

/** Score fuzzy rubric criteria with a structured JSON judge (live runs only). */
export async function judgeTrace(
	trace: AgentTrace,
	criteria: JudgeCriterion[],
	options: JudgeTraceOptions,
): Promise<JudgeTraceResult> {
	if (criteria.length === 0) {
		return { verdicts: [], skipped: true };
	}

	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		return {
			verdicts: [],
			skipped: true,
			error: "CURSOR_API_KEY not set — judge criteria skipped",
		};
	}

	const transcript = transcriptForJudge(trace);
	const transcriptChars = transcript.length;
	const verdicts: JudgeVerdict[] = [];

	for (const criterion of criteria) {
		const prompt = buildJudgePrompt(transcript, criterion.question);
		const parsed = await runJudgePrompt(prompt, { ...options, apiKey });
		verdicts.push({
			id: criterion.id,
			pass: parsed.pass,
			rationale: parsed.rationale,
			evidence: parsed.evidence,
			infraError: parsed.infraError,
			rawSdkStatus: parsed.rawSdkStatus,
			sdkError: parsed.sdkError,
			attempt: 1,
			durationMs: parsed.durationMs,
			transcriptChars,
			promptChars: prompt.length,
		});
		if (parsed.error) {
			return { verdicts, skipped: false, error: parsed.error };
		}
	}

	return { verdicts, skipped: false };
}
