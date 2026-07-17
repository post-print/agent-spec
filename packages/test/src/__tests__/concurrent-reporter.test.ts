import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ConcurrentReporter } from "../concurrent-reporter.js";

function captureStdout(): { stream: Writable; chunks: string[] } {
	const chunks: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			chunks.push(String(chunk));
			cb();
		},
	});
	return { stream, chunks };
}

describe("ConcurrentReporter", () => {
	it("emits non-TTY phase and verdict lines", () => {
		const { stream, chunks } = captureStdout();
		const reporter = new ConcurrentReporter({
			workers: 2,
			total: 2,
			isTty: false,
			stdout: stream,
		});

		reporter.emit({
			type: "started",
			index: 1,
			total: 2,
			name: "alpha",
			host: "replay",
		});
		reporter.emit({ type: "phase", index: 1, name: "alpha", phase: "rubric" });
		reporter.emit({
			type: "finished",
			index: 1,
			total: 2,
			name: "alpha",
			result: {
				suite: "smoke",
				scenario: "alpha",
				passed: true,
				failures: [],
				durationMs: 12,
			},
			failures: [],
		});
		reporter.close();

		const text = chunks.join("");
		expect(text).toMatch(/alpha/);
		expect(text).toMatch(/rubric/);
		expect(text).toMatch(/PASS/);
	});

	it("uses sticky cursor control on TTY", () => {
		const { stream, chunks } = captureStdout();
		let now = 0;
		const reporter = new ConcurrentReporter({
			workers: 2,
			total: 2,
			isTty: true,
			stdout: stream,
			now: () => now,
		});

		reporter.emit({
			type: "started",
			index: 1,
			total: 2,
			name: "alpha",
			host: "replay",
		});
		now = 1500;
		reporter.emit({ type: "phase", index: 1, name: "alpha", phase: "agent" });
		reporter.emit({
			type: "finished",
			index: 1,
			total: 2,
			name: "alpha",
			result: {
				suite: "smoke",
				scenario: "alpha",
				passed: true,
				failures: [],
				durationMs: 20,
			},
			failures: [],
		});
		reporter.close();

		const text = chunks.join("");
		expect(text).toContain("\x1b[1A\x1b[2K");
		expect(text).toMatch(/PASS/);
	});
});
