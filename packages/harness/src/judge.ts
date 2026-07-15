import { runJudgeClassifier } from "./cursor-run";
import type { AgentTrace } from "./types";

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

/** Parse structured judge JSON (`verdict`, `evidence`, `rationale`). */
export function parseJudgeJsonResponse(text: string): ParsedJudgeJson {
	const trimmed = text.trim();
	const candidates = [trimmed];

	const fenced = trimmed.match(JSON_FENCE_PATTERN);
	if (fenced?.[1]) {
		candidates.unshift(fenced[1].trim());
	}

	const objectMatch = trimmed.match(JSON_OBJECT_PATTERN);
	if (objectMatch?.[0]) {
		candidates.push(objectMatch[0]);
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as Record<string, unknown>;
			const verdict = normalizeVerdict(parsed.verdict);
			if (verdict !== undefined) {
				return {
					pass: verdict === "yes",
					rationale: String(parsed.rationale ?? "").trim() || "no rationale",
					evidence: Array.isArray(parsed.evidence)
						? parsed.evidence.map((item) => String(item)).filter(Boolean)
						: [],
					valid: true,
				};
			}
		} catch {
			// try next candidate
		}
	}

	return {
		pass: false,
		rationale: "judge returned invalid JSON (expected { verdict, evidence, rationale })",
		evidence: [],
		valid: false,
	};
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

/** Parse structured JSON first, then legacy YES/NO prose. */
export function parseJudgeResponse(text: string): ParsedJudgeJson {
	const json = parseJudgeJsonResponse(text);
	if (json.valid) {
		return json;
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

async function runJudgePrompt(
	prompt: string,
	options: JudgeTraceOptions,
): Promise<{ pass: boolean; rationale: string; evidence: string[]; error?: string }> {
	const apiKey = options.apiKey ?? process.env.CURSOR_API_KEY;
	if (!apiKey) {
		return {
			pass: false,
			rationale: "CURSOR_API_KEY not set",
			evidence: [],
			error: "missing api key",
		};
	}

	try {
		const result = await runJudgeClassifier({
			cwd: options.cwd,
			prompt,
			apiKey,
		});
		if (result.status !== "completed") {
			return {
				pass: false,
				rationale: `judge run status: ${result.status}`,
				evidence: [],
				error: `judge run status: ${result.status}`,
			};
		}
		const parsed = parseJudgeResponse(result.text);
		if (!parsed.valid) {
			return {
				pass: false,
				rationale: `${parsed.rationale} (raw: ${result.text.slice(0, 160) || "empty"})`,
				evidence: [],
				error: parsed.rationale,
			};
		}
		return { pass: parsed.pass, rationale: parsed.rationale, evidence: parsed.evidence };
	} catch (error) {
		const message = error instanceof Error ? error.message : "judge prompt failed";
		return { pass: false, rationale: message, evidence: [], error: message };
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
	const verdicts: JudgeVerdict[] = [];

	for (const criterion of criteria) {
		const prompt = buildJudgePrompt(transcript, criterion.question);
		const parsed = await runJudgePrompt(prompt, { ...options, apiKey });
		verdicts.push({
			id: criterion.id,
			pass: parsed.pass,
			rationale: parsed.rationale,
			evidence: parsed.evidence,
		});
		if (parsed.error) {
			return { verdicts, skipped: false, error: parsed.error };
		}
	}

	return { verdicts, skipped: false };
}
