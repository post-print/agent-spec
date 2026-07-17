import { formatDurationLabel, theme } from "./theme.js";
import type { AssertionFailure, JudgeVerdictResult, ScenarioResult } from "./types.js";

export type WorkerEvent =
	| {
			type: "started";
			index: number;
			total: number;
			name: string;
			host: string;
	  }
	| {
			type: "phase";
			index: number;
			name: string;
			phase: string;
	  }
	| {
			type: "heartbeat";
			index: number;
			name: string;
			elapsedMs: number;
	  }
	| {
			type: "finished";
			index: number;
			total: number;
			name: string;
			result: ScenarioResult;
			judgeVerdicts?: JudgeVerdictResult[];
			failures: AssertionFailure[];
			debug?: boolean;
			debugBundleDir?: string;
	  }
	| {
			type: "skipped";
			index: number;
			total: number;
			name: string;
	  };

export interface ConcurrentReporterOptions {
	workers: number;
	total: number;
	/** Override for tests. */
	isTty?: boolean;
	stdout?: NodeJS.WritableStream;
	now?: () => number;
}

interface SlotState {
	index: number;
	name: string;
	phase: string;
	startedAt: number;
}

export interface ProgressAdapter {
	started(host: string): void;
	phase(phase: string): void;
	heartbeat(elapsedMs: number): void;
	finished(
		result: ScenarioResult,
		meta: {
			judgeVerdicts?: JudgeVerdictResult[];
			failures: AssertionFailure[];
			debug?: boolean;
			debugBundleDir?: string;
		},
	): void;
	skipped(): void;
}

/**
 * Parent-owned concurrent progress UI.
 * TTY: sticky worker slots + append-only verdicts.
 * Non-TTY: plain prefixed lines (no cursor control).
 */
export class ConcurrentReporter {
	private readonly workers: number;
	private readonly total: number;
	private readonly isTty: boolean;
	private readonly stdout: NodeJS.WritableStream;
	private readonly now: () => number;
	private readonly slots = new Map<number, SlotState>();
	private stickyLineCount = 0;
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	constructor(options: ConcurrentReporterOptions) {
		this.workers = options.workers;
		this.total = options.total;
		this.isTty = options.isTty ?? Boolean(process.stdout.isTTY);
		this.stdout = options.stdout ?? process.stdout;
		this.now = options.now ?? (() => performance.now());
		if (this.isTty) {
			this.heartbeatTimer = setInterval(() => this.renderSticky(), 1000);
			this.heartbeatTimer.unref?.();
		}
	}

	adapter(index: number, name: string): ProgressAdapter {
		return createProgressAdapter(this, index, this.total, name);
	}

	emit(event: WorkerEvent): void {
		switch (event.type) {
			case "started":
				this.slots.set(event.index, {
					index: event.index,
					name: event.name,
					phase: "starting",
					startedAt: this.now(),
				});
				if (this.isTty) {
					this.renderSticky();
				} else {
					this.writeLine(
						`${theme.scenarioTitle(event.index, event.total, event.name, event.host)}  ${theme.phaseDim("started")}`,
					);
				}
				break;
			case "phase": {
				const slot = this.slots.get(event.index);
				if (slot) {
					slot.phase = event.phase;
				}
				if (this.isTty) {
					this.renderSticky();
				} else {
					this.writeLine(
						`  [${event.index}/${this.total}] ${event.name}  ${theme.phase(event.phase)}`,
					);
				}
				break;
			}
			case "heartbeat": {
				const slot = this.slots.get(event.index);
				if (slot) {
					slot.phase = `running ${formatDurationLabel(event.elapsedMs)}`;
				}
				if (this.isTty) {
					this.renderSticky();
				} else {
					this.writeLine(
						`  [${event.index}/${this.total}] ${event.name}  ${theme.duration(formatDurationLabel(event.elapsedMs))}`,
					);
				}
				break;
			}
			case "skipped":
				this.slots.delete(event.index);
				this.clearSticky();
				this.writeLine(theme.skipped(`[${event.index}/${event.total}] ${event.name}`));
				this.renderSticky();
				break;
			case "finished": {
				this.slots.delete(event.index);
				this.clearSticky();
				const lines = theme.scenarioVerdict({
					passed: event.result.passed,
					index: event.index,
					total: event.total,
					name: event.name,
					durationMs: event.result.durationMs,
					judgeVerdicts: event.judgeVerdicts,
					rubricFailures: event.failures.map((f) => ({
						matcher: f.matcher,
						message: f.message,
						category: f.category,
						evidence: f.evidence,
					})),
					failureCategory: event.failures[0]?.category,
					debug: event.debug,
					debugBundleDir: event.debugBundleDir,
				});
				for (const line of lines) {
					this.writeLine(line);
				}
				this.renderSticky();
				break;
			}
			default:
				break;
		}
	}

	/** Stop heartbeat timer and clear sticky region. */
	close(): void {
		if (this.heartbeatTimer !== undefined) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		this.clearSticky();
	}

	private writeLine(line: string): void {
		this.stdout.write(`${line}\n`);
	}

	private clearSticky(): void {
		if (!this.isTty || this.stickyLineCount === 0) {
			this.stickyLineCount = 0;
			return;
		}
		for (let i = 0; i < this.stickyLineCount; i++) {
			this.stdout.write("\x1b[1A\x1b[2K");
		}
		this.stickyLineCount = 0;
	}

	private renderSticky(): void {
		if (!this.isTty) {
			return;
		}
		this.clearSticky();
		const active = [...this.slots.values()].sort((a, b) => a.index - b.index);
		if (active.length === 0) {
			return;
		}
		const lines = active.map((slot) => {
			const elapsed = formatDurationLabel(this.now() - slot.startedAt);
			return `  ${theme.phaseDim("▸")} ${theme.workerSlot(slot.index, this.total, slot.name)}  ${theme.phase(slot.phase)}  ${theme.duration(elapsed)}`;
		});
		while (lines.length < Math.min(this.workers, this.total)) {
			lines.push(`  ${theme.phaseDim("·")}`);
		}
		for (const line of lines) {
			this.writeLine(line);
		}
		this.stickyLineCount = lines.length;
	}
}

/** Progress adapter for in-process scenarios under ConcurrentReporter. */
export function createProgressAdapter(
	reporter: ConcurrentReporter,
	index: number,
	total: number,
	name: string,
): ProgressAdapter {
	return {
		started(host: string) {
			reporter.emit({ type: "started", index, total, name, host });
		},
		phase(phase: string) {
			reporter.emit({ type: "phase", index, name, phase });
		},
		heartbeat(elapsedMs: number) {
			reporter.emit({ type: "heartbeat", index, name, elapsedMs });
		},
		finished(result, meta) {
			reporter.emit({
				type: "finished",
				index,
				total,
				name,
				result,
				judgeVerdicts: meta.judgeVerdicts,
				failures: meta.failures,
				debug: meta.debug,
				debugBundleDir: meta.debugBundleDir,
			});
		},
		skipped() {
			reporter.emit({ type: "skipped", index, total, name });
		},
	};
}
