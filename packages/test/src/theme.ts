import { basename } from "node:path";
import chalk from "chalk";

const RATIONALE_WRAP_COLS = 72;

export function colorEnabled(): boolean {
	return chalk.level > 0;
}

/** Truncate long temp/session paths to `…/last` or `…/parent/last`. */
export function truncatePath(path: string): string {
	if (process.env.AGENT_TEST_VERBOSE_PATHS === "1") {
		return path;
	}
	const parts = path.split("/").filter(Boolean);
	if (parts.length <= 2) {
		return path;
	}
	return `…/${parts.slice(-2).join("/")}`;
}

/** Word-wrap text at `cols` without breaking words when possible. */
export function wrapText(text: string, cols = RATIONALE_WRAP_COLS): string[] {
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
}

export interface ScenarioVerdictOptions {
	passed: boolean;
	index?: number;
	total?: number;
	name: string;
	durationMs: number;
	judgeVerdicts?: JudgeVerdictDisplay[];
	rubricFailures?: RubricFailureDisplay[];
}

export function formatDurationLabel(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	return `${(ms / 1000).toFixed(1)}s`;
}

function criterionLabel(count: number): string {
	return count === 1 ? "1 criterion" : `${count} criteria`;
}

export const theme = {
	suiteHeader(name: string, host: string, count: number): string {
		const scenarios = count === 1 ? "1 scenario" : `${count} scenarios`;
		return `${chalk.bold.cyan(name)}${chalk.dim(` (${host})`)}  ${chalk.dim(scenarios)}`;
	},

	scenarioTitle(
		index: number,
		total: number,
		name: string,
		host: string,
	): string {
		return `${chalk.bold(`[${index}/${total}]`)} ${chalk.bold.white(name)}${chalk.dim(` (${host})`)}`;
	},

	scenarioLabel(name: string, host?: string): string {
		return host
			? `${chalk.bold.white(name)}${chalk.dim(` (${host})`)}`
			: chalk.bold.white(name);
	},

	phaseTree(prefix: "├─" | "└─" | "│   ", message: string): string {
		return `  ${chalk.dim(prefix)} ${message}`;
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

	statusCompleted(status: string): string {
		return status === "completed" ? chalk.green(status) : chalk.red(status);
	},

	tip(message: string): string {
		return chalk.dim.italic(message);
	},

	warn(message: string): string {
		return `${chalk.yellow("⚠")} ${chalk.yellow(message)}`;
	},

	banner(): string {
		return `${chalk.bold.cyan("agent-test")} ${chalk.dim("live dogfood")}`;
	},

	bannerDetail(message: string): string {
		return `  ${chalk.dim(message)}`;
	},

	bannerSession(path: string): string {
		return `  ${chalk.dim("session")}  ${chalk.cyan(truncatePath(path))}`;
	},

	summary(
		suite: string,
		passed: number,
		failed: number,
		skipped: number,
	): string {
		const parts = [
			`${chalk.bold.cyan(suite)}:`,
			chalk.green(`${passed} passed`),
			failed > 0
				? chalk.red(`${failed} failed`)
				: chalk.dim(`${failed} failed`),
			chalk.dim(`${skipped} skipped`),
		];
		return parts.join(" ");
	},

	failedScenariosHeader(): string {
		return chalk.dim("Failed scenarios:");
	},

	failedScenarioName(name: string): string {
		return `  ${chalk.red("✗")} ${name}`;
	},

	verboseFailure(matcher: string, message: string): string {
		return `      ${chalk.dim(matcher)}  ${message}`;
	},

	judgePhase(count: number): string {
		return `LLM judge ${chalk.dim(`(${criterionLabel(count)})`)}…`;
	},

	isolationNote(): string {
		return chalk.dim.italic("live isolation: one subprocess per scenario");
	},

	skipped(label: string): string {
		return `${chalk.dim(label)} — ${chalk.dim("skipped")}`;
	},

	scenarioVerdict(options: ScenarioVerdictOptions): string[] {
		const status = options.passed
			? chalk.bold.green("PASS")
			: chalk.bold.red("FAIL");
		const counter =
			options.index !== undefined && options.total !== undefined
				? `[${options.index}/${options.total}] `
				: "";
		const duration = chalk.yellow(
			`(${formatDurationLabel(options.durationMs)})`,
		);
		const lines: string[] = [
			`  ${chalk.dim("│")}`,
			`  ${chalk.dim("│")}  ${status}  ${counter}${chalk.bold.white(options.name)}  ${duration}`,
		];

		for (const verdict of options.judgeVerdicts ?? []) {
			const color = verdict.pass ? chalk.green : chalk.red;
			lines.push(
				`  ${chalk.dim("│")}    ${chalk.dim("judge")}  ${chalk.dim(verdict.question)}`,
			);
			for (const wrapped of wrapText(verdict.rationale)) {
				lines.push(`  ${chalk.dim("│")}           ${color(wrapped)}`);
			}
		}

		for (const failure of options.rubricFailures ?? []) {
			lines.push(
				`  ${chalk.dim("│")}    ${chalk.yellow("rubric")}  ${chalk.dim(failure.matcher)}`,
			);
			for (const wrapped of wrapText(failure.message)) {
				lines.push(`  ${chalk.dim("│")}           ${chalk.yellow(wrapped)}`);
			}
		}

		return lines;
	},
};
