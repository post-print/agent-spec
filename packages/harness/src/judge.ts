import { runJudgeClassifier } from "./cursor-run.js";
import type { AgentTrace } from "./types.js";

// Optional info-string (`json`, `js`, `typescript`, …) on the opening fence line.
// Without this, ` ```js\n"yes"\n``` ` extracts `js\n"yes"` and never latches.
const JSON_FENCE_PATTERN = /```[^\n`]*\s*([\s\S]*?)```/;
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
	 * True when the reply is a real JSON contract attempt (parsed array,
	 * parsed object with a `verdict` key, or truncated/unparseable JSON-shaped
	 * text). Incidental `{…}` blobs and instructional `"verdict":` prose must
	 * not set this — callers may still fall back to YES/NO salvage then.
	 */
	structured: boolean;
};

// Whole-reply opening fence is a contract attempt regardless of info-string
// (`json`, `js`, `typescript`, bare, …). Mid-prose fence mentions do not match.
const JUDGE_JSON_FENCE_OPEN_PATTERN = /^```/;
const JUDGE_VERDICT_KEY_PATTERN = /"verdict"\s*:/;
/** Same prefixes legacy YES/NO strips — gate same-line JSON peels. */
const JUDGE_VERDICT_PREFIX_PATTERN = /^(?:answer|verdict|line\s*1)\s*:\s*/i;
/** Complete JSON number token (rejects bare `1.` with no fractional digits). */
const JUDGE_JSON_NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const JUDGE_JSON_BOOL_NULL_TOKEN = /^(?:true|false|null)/i;
/** Closed fences, or a trailing unclosed fence (prose preamble + open contract). */
const MARKDOWN_FENCE_STRIP_PATTERN = /```[^\n`]*\s*[\s\S]*?(?:```|$)/g;

/**
 * After a complete JSON number/bool/null token: whether the remainder is
 * contract junk (latch) vs English continuation (allow YES/NO salvage).
 *
 * `true\nYES` / `3 YES` / `42,` / `3, YES` → latch.
 * `true story` / `3 findings` / `3, findings` / `true, the agent` → salvage.
 */
function jsonPrimitiveRemainderIsContract(rest: string): boolean {
	if (rest === "") {
		return true;
	}
	const restTrim = rest.trimStart();
	if (restTrim === "") {
		return true;
	}
	// Comma after a primitive is JSON-ish only when nothing English follows
	// (`42,` / `3, YES`). List/prose continuations (`3, findings`, `1, 2, and 3`)
	// must still reach YES/NO salvage.
	if (restTrim.startsWith(",")) {
		const afterComma = restTrim.slice(1).trimStart();
		if (afterComma === "") {
			return true;
		}
		if (/^(?:yes|no)\b/i.test(afterComma)) {
			return true;
		}
		if (/[A-Za-z]/.test(afterComma)) {
			return false;
		}
		return true;
	}
	const firstWord = /^([A-Za-z]+)/.exec(restTrim)?.[1]?.toLowerCase();
	if (firstWord === "yes" || firstWord === "no") {
		return true;
	}
	if (/^[A-Za-z]/.test(restTrim)) {
		return false;
	}
	return true;
}

/**
 * Detect truncated/unparseable JSON-shaped contract attempts. Only replies
 * that *are* JSON-shaped (value prefix or open with a fence) count — a mid-prose
 * mention of ```json or an incidental blob is not a contract attempt.
 *
 * Number/bool/null prefixes latch only for a complete JSON token (optionally
 * with trailing junk). Numbered-list prose (`1. …`) and English continuations
 * (`true story`, `3 findings`) must not latch — YES/NO salvage still applies.
 */
function looksLikeJudgeJsonAttempt(text: string): boolean {
	const trimmed = text.trim();
	if (JUDGE_JSON_FENCE_OPEN_PATTERN.test(trimmed)) {
		return true;
	}
	if (/^["{[]/.test(trimmed)) {
		return true;
	}

	const number = JUDGE_JSON_NUMBER_TOKEN.exec(trimmed);
	if (number) {
		const rest = trimmed.slice(number[0].length);
		// `1. prose` / `10) prose` — list markers, not number-then-junk.
		if (/^[.)]/.test(rest)) {
			return false;
		}
		return jsonPrimitiveRemainderIsContract(rest);
	}

	const boolNull = JUDGE_JSON_BOOL_NULL_TOKEN.exec(trimmed);
	if (boolNull) {
		return jsonPrimitiveRemainderIsContract(trimmed.slice(boolNull[0].length));
	}

	return false;
}

/** Drop fenced bodies so legacy YES/NO does not match inside quoted JSON strings. */
function stripMarkdownFencesForLegacy(text: string): string {
	return text.replace(MARKDOWN_FENCE_STRIP_PATTERN, "\n");
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

function arrayLooksLikeJudgeContract(parsed: unknown[]): boolean {
	if (
		parsed.some(
			(item) =>
				item !== null &&
				typeof item === "object" &&
				!Array.isArray(item) &&
				"verdict" in (item as Record<string, unknown>),
		)
	) {
		return true;
	}
	// Wrong-shaped contract answers like `["yes"]` / `["no"]` — not incidental
	// lists such as `[1,2,3]` or `["intro","summary"]`.
	return (
		parsed.length > 0 &&
		parsed.every((item) => typeof item === "string" && normalizeVerdict(item) !== undefined)
	);
}

/** Peeled objects with judge-schema keys but no `verdict` are contract attempts. */
function objectLooksLikeJudgeSchema(record: Record<string, unknown>): boolean {
	return "evidence" in record || "rationale" in record;
}

/**
 * Try structured judge JSON. `structured` latches only for real contract
 * attempts: whole-text/fenced JSON bodies, verdict-shaped arrays or objects,
 * or failed candidates carrying a `verdict` key — not incidental arrays,
 * mid-prose truncated blobs, or fence mentions inside prose.
 */
function tryParseJudgeJson(text: string): JudgeJsonParseAttempt {
	const trimmed = text.trim();
	const candidates = [trimmed];

	const fenced = trimmed.match(JSON_FENCE_PATTERN);
	const fencedBody = fenced?.[1]?.trim();
	if (fencedBody) {
		candidates.unshift(fencedBody);
	}

	const arrayShaped = isArrayShapedJudgeJson(trimmed);
	// Prose-prefixed single objects may still use greedy `{…}` extraction.
	// Array-shaped replies (including truncated `[{…}`) must not peel inner objects.
	if (!arrayShaped) {
		const objectMatch = trimmed.match(JSON_OBJECT_PATTERN);
		if (objectMatch?.[0]) {
			candidates.push(objectMatch[0]);
		}
		const brace = trimmed.indexOf("{");
		if (brace > 0) {
			candidates.push(trimmed.slice(brace));
		}
	} else {
		const bracket = trimmed.indexOf("[");
		if (bracket >= 0) {
			candidates.push(trimmed.slice(bracket));
		}
	}

	// Contract peels under a prose preamble (not mid-prose incidental quotes):
	// - line-leading `"…` / `[…` (`Answer:\n"yes"`)
	// - line-leading JSON number/bool/null (`Answer:\n42\nYES`)
	// - same-line after answer|verdict|line 1: (`Answer: "yes"`, `Verdict: 42`)
	// Mid-line quotes without that prefix (`YES` + ```js\n"yes"\n```) stay
	// incidental — fence bodies use `fencedBody` / whole-reply fence primary.
	const lineLeadingJsonValues = new Set<string>();
	let insideFence = false;

	const pushContractPeel = (value: string): void => {
		const peel = value.trim();
		if (!peel) {
			return;
		}
		candidates.push(peel);
		lineLeadingJsonValues.add(peel);
	};

	const isLineLeadingJsonPrimitive = (lineTrim: string): boolean => {
		if (lineTrim.startsWith('"') || lineTrim.startsWith("[")) {
			return true;
		}
		// Complete number/bool/null lines (optional contract junk) — not English
		// (`3 findings`, `true story`) which looksLikeJudgeJsonAttempt rejects.
		return (
			looksLikeJudgeJsonAttempt(lineTrim) &&
			(JUDGE_JSON_NUMBER_TOKEN.test(lineTrim) || JUDGE_JSON_BOOL_NULL_TOKEN.test(lineTrim))
		);
	};

	for (const line of trimmed.split("\n")) {
		const lineTrim = line.trim();
		if (lineTrim.startsWith("```")) {
			insideFence = !insideFence;
			continue;
		}
		if (insideFence) {
			continue;
		}
		if (isLineLeadingJsonPrimitive(lineTrim)) {
			pushContractPeel(lineTrim);
		}
		const prefix = JUDGE_VERDICT_PREFIX_PATTERN.exec(lineTrim);
		if (prefix) {
			const remainder = lineTrim.slice(prefix[0].length).trim();
			if (
				remainder.startsWith('"') ||
				remainder.startsWith("[") ||
				remainder.startsWith("{") ||
				isLineLeadingJsonPrimitive(remainder)
			) {
				pushContractPeel(remainder);
			}
		}
	}

	let structured = false;
	let failedJsonShape = false;
	// Only whole-reply fences are primary contract attempts. Mid-prose fences
	// (e.g. YES + ```js\n"yes"\n```) stay incidental like unfenced peels.
	const wholeReplyFence = JUDGE_JSON_FENCE_OPEN_PATTERN.test(trimmed);
	for (const candidate of candidates) {
		const candidateTrim = candidate.trim();
		const primary =
			candidateTrim === trimmed ||
			(wholeReplyFence && fencedBody !== undefined && candidateTrim === fencedBody);
		const lineLeading = lineLeadingJsonValues.has(candidateTrim);
		try {
			const parsed: unknown = JSON.parse(candidate);
			if (parsed === null || typeof parsed !== "object") {
				// Whole-text/fenced JSON primitives (`"yes"`, `42`, `true`, `null`)
				// are contract attempts that violate the object contract — refuse
				// and latch so callers do not YES/NO-salvage a quoted verdict.
				// Preamble peels (`Answer:\n"yes"`, `Answer: "yes"`, `Answer:\n42`)
				// are the same wrong-shaped contract; mid-line incidental quote
				// peels stay out of `lineLeadingJsonValues`.
				if (primary || lineLeading) {
					return { result: { ...INVALID_JUDGE_JSON }, structured: true };
				}
				continue;
			}
			if (Array.isArray(parsed)) {
				// Whole-text/fenced arrays are contract attempts; peeled arrays count
				// when verdict-shaped or yes/no string arrays (`["yes"]`). Incidental
				// lists (e.g. `Scores: [1,2,3]`) still allow YES/NO salvage.
				if (primary || arrayLooksLikeJudgeContract(parsed)) {
					return { result: { ...INVALID_JUDGE_JSON }, structured: true };
				}
				continue;
			}
			const record = parsed as Record<string, unknown>;
			// Objects without `verdict`: schema-shaped peels (`evidence`/`rationale`)
			// are failed contract attempts; bare quote blobs stay incidental.
			if (!("verdict" in record)) {
				if (primary || objectLooksLikeJudgeSchema(record)) {
					return { result: { ...INVALID_JUDGE_JSON }, structured: true };
				}
				continue;
			}
			structured = true;
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
			return { result: { ...INVALID_JUDGE_JSON }, structured: true };
		} catch {
			// A failed parse latches `structured` only for real contract attempts:
			// the whole/fenced body is a JSON value (object/array/primitive),
			// including trailing junk after a primitive (`"yes" clearly`), or a
			// peeled candidate carries a `"verdict":` key (truncated contract).
			// Line-leading string/array peels (`Answer:\n"yes" clearly`,
			// `Answer:\n["yes"`) latch the same way. Mid-prose incidental peels
			// (e.g. `Evidence: {"quote":"hello"`) keep YES/NO salvage available.
			if (primary) {
				if (looksLikeJudgeJsonAttempt(candidateTrim)) {
					failedJsonShape = true;
				}
			} else if (
				(candidateTrim.startsWith("{") || candidateTrim.startsWith("[")) &&
				JUDGE_VERDICT_KEY_PATTERN.test(candidateTrim)
			) {
				failedJsonShape = true;
			} else if (lineLeading && looksLikeJudgeJsonAttempt(candidateTrim)) {
				failedJsonShape = true;
			}
		}
	}

	return {
		result: { ...INVALID_JUDGE_JSON },
		structured: structured || failedJsonShape || looksLikeJudgeJsonAttempt(trimmed),
	};
}

/** Parse structured judge JSON (`verdict`, `evidence`, `rationale`). */
export function parseJudgeJsonResponse(text: string): ParsedJudgeJson {
	return tryParseJudgeJson(text).result;
}

const JUDGE_MARKDOWN_TRIM_PATTERN = /^\*+\s*|\s*\*+$/g;
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
 * Once a real JSON contract attempt is detected (array, object with `verdict`,
 * or truncated JSON-shaped text), never salvage YES/NO from the body — invalid
 * contracts are infra failures, not rubric answers.
 */
export function parseJudgeResponse(text: string): ParsedJudgeJson {
	const { result, structured } = tryParseJudgeJson(text);
	if (result.valid || structured) {
		return result;
	}
	// Strip fences so preamble + ```json\n"yes"\n``` cannot salvage from the
	// quoted primitive; outer YES/NO beside incidental fences still works.
	return parseJudgeLegacyResponse(stripMarkdownFencesForLegacy(text));
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
