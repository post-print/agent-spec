import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import chalk from "chalk";

import type { ScenarioStory } from "./types.js";

const FALLBACK_COLUMNS = 80;
const MIN_WRAP_COLS = 40;
const STORY_GUTTER = "    ";
const STORY_LABEL_WIDTH = 12;
const STORY_INDENT = STORY_GUTTER.length + STORY_LABEL_WIDTH;

/** Word-wrap width for a line that already has `indent` visible columns. */
export function wrapColumnWidth(indent: number, columns = process.stdout.columns): number {
	const cols = typeof columns === "number" && columns > 0 ? columns : FALLBACK_COLUMNS;
	return Math.max(MIN_WRAP_COLS, cols - indent);
}

/** OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL */
const OSC8_OPEN = "\u001b]8;;";
const OSC8_CLOSE = "\u0007";

/** Always enable ANSI color — agent-test is a human CLI, not a pipe filter. */
export function configureCliColor(): void {
	chalk.level = 3;
}

export function colorEnabled(): boolean {
	return chalk.level > 0;
}

/** OSC-8 hyperlink. Cursor opens `http://` in the browser and `file://` in the editor. */
export function formatHyperlink(url: string, display: string): string {
	return `${OSC8_OPEN}${url}${OSC8_CLOSE}${display}${OSC8_OPEN}${OSC8_CLOSE}`;
}

/**
 * Wrap a filesystem path in an OSC-8 `file://` hyperlink.
 * Display text stays a plain path for copy-paste.
 */
export function formatFileHyperlink(absolutePath: string, display = absolutePath): string {
	return formatHyperlink(pathToFileURL(absolutePath).href, display);
}

/** Truncate long temp/session paths to `…/last` or `…/parent/last`. */
export function truncatePath(path: string): string {
	if (
		process.env.AGENT_TEST_VERBOSE_PATHS === "1" ||
		process.env.AGENT_TEST_DEBUG === "1" ||
		process.env.AGENT_TEST_DEBUG === "true"
	) {
		return path;
	}
	const parts = path.split("/").filter(Boolean);
	if (parts.length <= 2) {
		return path;
	}
	return `…/${parts.slice(-2).join("/")}`;
}

/** Word-wrap text at `cols` without breaking words when possible. */
export function wrapText(text: string, cols = wrapColumnWidth(0)): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return [];
	}
	const lines: string[] = [];
	let current = words[0] ?? "";
	for (let i = 1; i < words.length; i++) {
		const word = words[i] ?? "";
		if (`${current} ${word}`.length <= cols) {
			current = `${current} ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	lines.push(current);
	return lines;
}

export interface JudgeVerdictDisplay {
	id: string;
	question: string;
	pass: boolean;
	rationale: string;
}

export interface RubricFailureDisplay {
	matcher: string;
	message: string;
	category?: string;
	evidence?: string;
}

export interface ScenarioVerdictOptions {
	passed: boolean;
	index?: number;
	total?: number;
	name: string;
	durationMs: number;
	/** Total tokens (agent + judge) when reported. */
	totalTokens?: number;
	judgeVerdicts?: JudgeVerdictDisplay[];
	rubricFailures?: RubricFailureDisplay[];
	/** Primary failure category for the FAIL line. */
	failureCategory?: string;
	/** Criteria and result lines. */
	story?: ScenarioStory;
	/** Show evidence and full failure detail (--debug / AGENT_TEST_VERBOSE). */
	debug?: boolean;
	debugBundleDir?: string;
}

export function formatTokenNumber(totalTokens: number): string {
	if (totalTokens >= 1_000_000) {
		return `${(totalTokens / 1_000_000).toFixed(1)}M`;
	}
	if (totalTokens >= 1000) {
		return `${(totalTokens / 1000).toFixed(1)}k`;
	}
	return String(totalTokens);
}

export function formatTokenCount(totalTokens: number): string {
	return `${formatTokenNumber(totalTokens)} tok`;
}

const FAILURE_CATEGORY_LABEL: Record<string, string> = {
	rubric_miss: "rubric",
	judge_infra: "judge infra",
	judge_parse: "judge parse",
	agent_runtime: "agent runtime",
	worktree_leak: "worktree leak",
	recording_error: "recording",
};

export function formatFailureCategory(category?: string): string | undefined {
	if (!category) {
		return undefined;
	}
	return FAILURE_CATEGORY_LABEL[category] ?? category.replaceAll("_", " ");
}

export function formatDurationLabel(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Elapsed clock for an in-flight agent. Tenths of a second. */
export function formatClock(ms: number): string {
	return `${Math.max(0, ms / 1000).toFixed(1)}s`;
}

/** Visible character count that skips CSI color sequences. */
export function visibleLength(text: string): number {
	let count = 0;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 27) {
			const end = text.indexOf("m", index);
			if (end === -1) {
				break;
			}
			index = end;
			continue;
		}
		count += 1;
	}
	return count;
}

/** Keep a live clock line on one terminal row so `\r` can overwrite it. */
export function clipToColumns(text: string, columns: number): string {
	const cols = Math.max(20, columns);
	if (visibleLength(text) <= cols) {
		return text;
	}
	let count = 0;
	let end = 0;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 27) {
			const seqEnd = text.indexOf("m", index);
			if (seqEnd === -1) {
				end = text.length;
				break;
			}
			index = seqEnd;
			end = index + 1;
			continue;
		}
		if (count >= cols - 1) {
			break;
		}
		count += 1;
		end = index + 1;
	}
	return `${text.slice(0, end)}…`;
}

function criterionLabel(count: number): string {
	return count === 1 ? "1 criterion" : `${count} criteria`;
}

export const theme = {
	suiteHeader(name: string, host: string, count: number): string {
		const scenarios = count === 1 ? "1 scenario" : `${count} scenarios`;
		return `${chalk.bold.cyan(name)}  ${chalk.dim("·")}  ${chalk.dim(host)}  ${chalk.dim("·")}  ${chalk.dim(scenarios)}`;
	},

	scenarioTitle(index: number, total: number, name: string, host: string): string {
		return `\n${chalk.bold(`[${index}/${total}]`)} ${chalk.bold.white(name)}  ${chalk.dim(`(${host})`)}`;
	},

	scenarioLabel(name: string, host?: string): string {
		return host ? `${chalk.bold.white(name)}  ${chalk.dim(`(${host})`)}` : chalk.bold.white(name);
	},

	phaseTree(_prefix: "├─" | "└─" | "│   ", message: string): string {
		return `    ${message}`;
	},

	hostLog(level: string, service: string, detail: string): string {
		const levelColor = level === "error" ? chalk.red : level === "warn" ? chalk.yellow : chalk.dim;
		return `    ${chalk.dim("host")}  ${levelColor(level.toUpperCase())}  ${chalk.dim(service)}  ${chalk.dim(detail)}`;
	},

	path(p: string): string {
		return chalk.cyan(truncatePath(p));
	},

	basename(p: string): string {
		return chalk.cyan(basename(p));
	},

	duration(label: string): string {
		return chalk.yellow(label);
	},

	phaseDim(message: string): string {
		return chalk.dim(message);
	},

	phase(label: string, detail?: string): string {
		if (!detail) {
			return chalk.dim(label);
		}
		return `${chalk.dim(label)}  ${detail}`;
	},

	agentClock(elapsedLabel: string, preview?: string): string {
		const clock = theme.phase("agent", theme.duration(elapsedLabel));
		if (!preview) {
			return clock;
		}
		return `${clock}  ${chalk.dim(preview)}`;
	},

	liveTool(name: string, detail?: string): string {
		if (!detail) {
			return chalk.dim(name);
		}
		return `${chalk.dim(name)}  ${chalk.cyan(detail)}`;
	},

	statusCompleted(status: string): string {
		return status === "completed" ? chalk.green(status) : chalk.red(status);
	},

	tip(message: string): string {
		return chalk.dim.italic(message);
	},

	/**
	 * Tip line with a clickable label.
	 * `http://` stays visible so Cursor can open the browser.
	 * A filesystem path stays in the OSC-8 URL only.
	 */
	fileTip(label: string, pathOrUrl: string): string {
		if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
			return theme.tip(`${formatHyperlink(pathOrUrl, label)}  ${pathOrUrl}`);
		}
		return theme.tip(formatFileHyperlink(pathOrUrl, label));
	},

	warn(message: string): string {
		return `${chalk.yellow("⚠")} ${chalk.yellow(message)}`;
	},

	banner(mode = "live"): string {
		return `${chalk.bold.cyan("agent-test")}  ${chalk.dim(mode)}`;
	},

	bannerDetail(message: string): string {
		return `    ${chalk.dim(message)}`;
	},

	bannerSession(path: string): string {
		return `    ${chalk.dim("session")}  ${chalk.cyan(truncatePath(path))}`;
	},

	bannerHints(hints: string[]): string {
		return `    ${chalk.dim(hints.join("  ·  "))}`;
	},

	runSummary(text: string): string {
		return text
			.split("\n")
			.map((line) => (line.startsWith("failures") ? chalk.red(line) : chalk.dim(line)))
			.join("\n");
	},

	summary(suite: string, passed: number, failed: number, skipped: number): string {
		const parts = [
			`${chalk.bold.cyan(suite)}:`,
			chalk.green(`${passed} passed`),
			failed > 0 ? chalk.red(`${failed} failed`) : chalk.dim(`${failed} failed`),
			chalk.dim(`${skipped} skipped`),
		];
		return parts.join(" ");
	},

	failedScenariosHeader(): string {
		return chalk.dim("Failed scenarios:");
	},

	failedScenarioName(name: string): string {
		return `    ${chalk.red("✗")} ${name}`;
	},

	verboseFailure(matcher: string, message: string, evidence?: string, category?: string): string {
		const prefix = category ? `${chalk.dim(category)}  ` : "";
		const base = `      ${prefix}${chalk.dim(matcher)}  ${message}`;
		if (!evidence) {
			return base;
		}
		return `${base}\n        ${chalk.dim(evidence)}`;
	},

	debugBundlePointer(path: string): string {
		return theme.phase("debug", theme.path(path));
	},

	judgePhase(count: number): string {
		return theme.phase("judge", chalk.dim(`(${criterionLabel(count)})`));
	},

	isolationNote(): string {
		return chalk.dim.italic("isolated subprocesses");
	},

	skipped(label: string): string {
		return `${chalk.dim(label)} — ${chalk.dim("skipped")}`;
	},

	scenarioVerdict(options: ScenarioVerdictOptions): string[] {
		const mark = options.passed ? chalk.bold.green("✓") : chalk.bold.red("✗");
		const status = options.passed ? chalk.bold.green("PASS") : chalk.bold.red("FAIL");
		const duration = chalk.yellow(formatDurationLabel(options.durationMs));
		const tokens =
			options.totalTokens !== undefined
				? chalk.dim(` · ${formatTokenCount(options.totalTokens)}`)
				: "";
		const primaryCategory = !options.passed
			? formatFailureCategory(options.failureCategory)
			: undefined;
		const category = primaryCategory ? `${chalk.yellow(primaryCategory)}  ` : "";
		const lines: string[] = ["", `    ${mark} ${status}  ${category}${duration}${tokens}`, ""];

		if (options.story) {
			const criteria = storyLines("criteria", options.story.criteria);
			const result = storyLines("result", options.story.result);
			const verdict = storyLines("result", options.story.verdict, options.passed, {
				continueLabel: result.length > 0,
			});
			lines.push(...criteria);
			if (criteria.length > 0 && (result.length > 0 || verdict.length > 0)) {
				lines.push("");
			}
			lines.push(...result);
			if (result.length > 0 && verdict.length > 0) {
				lines.push("");
			}
			lines.push(...verdict);
			lines.push("");
			if (options.debug) {
				const evidenceCols = wrapColumnWidth(STORY_INDENT);
				for (const failure of options.rubricFailures ?? []) {
					if (!failure.evidence) {
						continue;
					}
					for (const wrapped of wrapText(failure.evidence, evidenceCols)) {
						lines.push(`${STORY_GUTTER}${" ".repeat(STORY_LABEL_WIDTH)}${chalk.dim(wrapped)}`);
					}
				}
			}
		} else {
			const bodyCols = wrapColumnWidth(STORY_INDENT);
			for (const verdict of options.judgeVerdicts ?? []) {
				const color = verdict.pass ? chalk.green : chalk.red;
				lines.push(
					`${STORY_GUTTER}${chalk.dim("judge".padEnd(STORY_LABEL_WIDTH))}${chalk.dim(verdict.question)}`,
				);
				for (const wrapped of wrapText(verdict.rationale, bodyCols)) {
					lines.push(`${STORY_GUTTER}${" ".repeat(STORY_LABEL_WIDTH)}${color(wrapped)}`);
				}
				lines.push("");
			}

			for (const failure of options.rubricFailures ?? []) {
				const categoryLabel = formatFailureCategory(failure.category) ?? "rubric";
				lines.push(
					`${STORY_GUTTER}${chalk.yellow(categoryLabel.padEnd(STORY_LABEL_WIDTH))}${chalk.dim(failure.matcher)}`,
				);
				for (const wrapped of wrapText(failure.message, bodyCols)) {
					lines.push(`${STORY_GUTTER}${" ".repeat(STORY_LABEL_WIDTH)}${chalk.yellow(wrapped)}`);
				}
				if (options.debug && failure.evidence) {
					for (const wrapped of wrapText(failure.evidence, bodyCols)) {
						lines.push(`${STORY_GUTTER}${" ".repeat(STORY_LABEL_WIDTH)}${chalk.dim(wrapped)}`);
					}
				}
				lines.push("");
			}
		}

		if (options.debug && options.debugBundleDir) {
			lines.push(
				`    ${chalk.dim("debug")}     ${chalk.cyan(truncatePath(join(options.debugBundleDir, "transcript.md")))}`,
			);
		}

		return lines;
	},
};

function storyLines(
	label: "criteria" | "result",
	values: string[],
	passed?: boolean,
	options?: { continueLabel?: boolean },
): string[] {
	if (values.length === 0) {
		return [];
	}
	const lines: string[] = [];
	const hang = " ".repeat(STORY_LABEL_WIDTH);
	const cols = wrapColumnWidth(STORY_INDENT);
	const continueLabel = options?.continueLabel === true;
	for (const [index, value] of values.entries()) {
		if (index > 0 && passed !== undefined) {
			lines.push("");
		}
		const wrapped = wrapText(value, cols);
		const body = wrapped.length > 0 ? wrapped : [value];
		for (const [wrapIndex, part] of body.entries()) {
			const prefix =
				index === 0 && wrapIndex === 0 && !continueLabel
					? chalk.dim(label.padEnd(STORY_LABEL_WIDTH))
					: hang;
			const color =
				passed === false ? chalk.yellow : passed === true ? chalk.green : (text: string) => text;
			lines.push(`${STORY_GUTTER}${prefix}${color(part)}`);
		}
	}
	return lines;
}
