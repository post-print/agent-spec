import { describe, expect, it } from "bun:test";

import { encodeViewerEvent, parseViewerEvent, parseViewerEventLines } from "../viewer/events.js";

describe("viewer events", () => {
	it("round-trips a text envelope as one NDJSON line", () => {
		const event = {
			type: "text" as const,
			suite: "smoke",
			scenario: "hello",
			host: "cursor",
			text: "smoke ok",
		};
		const line = encodeViewerEvent(event);
		expect(line).toBe(
			'{"type":"text","suite":"smoke","scenario":"hello","host":"cursor","text":"smoke ok"}',
		);
		expect(line.includes("\n")).toBe(false);
		expect(parseViewerEvent(line)).toEqual(event);
	});

	it("round-trips loaded context files", () => {
		const event = {
			type: "context" as const,
			suite: "depth",
			scenario: "uses injected context",
			host: "cursor",
			mode: "harness-preamble" as const,
			hostInput: "Exact submitted input",
			files: [
				{
					path: "brief.md",
					text: "DEPTH_CONTEXT token: agent-test-depth-context-6d2a",
					reason: "contextSources",
					why: "The scenario lists brief.md in contextSources.",
				},
			],
		};
		expect(parseViewerEvent(encodeViewerEvent(event))).toEqual(event);
	});

	it("round-trips a setup status line", () => {
		const event = {
			type: "status" as const,
			suite: "depth",
			scenario: "uses injected context",
			host: "cursor",
			text: "Creating sealed workspace.",
		};
		expect(parseViewerEvent(encodeViewerEvent(event))).toEqual(event);
	});

	it("round-trips a compare-arm tool event", () => {
		const event = {
			type: "tool" as const,
			suite: "judge",
			scenario: "compares two workspace arms",
			host: "claude",
			arm: "a",
			name: "Read",
			args: { path: "word.txt" },
		};
		expect(parseViewerEvent(encodeViewerEvent(event))).toEqual(event);
	});

	it("round-trips the authoritative scenario result", () => {
		const event = {
			type: "scenario_result" as const,
			suite: "smoke",
			scenario: "hello",
			host: "cursor",
			result: {
				suite: "smoke",
				scenario: "hello",
				passed: false,
				failures: [
					{
						matcher: "mustInclude",
						message: "missing token",
						category: "rubric_miss" as const,
						evidence: "reply was empty",
					},
				],
				durationMs: 12,
			},
		};
		expect(parseViewerEvent(encodeViewerEvent(event))).toEqual(event);
	});

	it("ignores blank and invalid lines", () => {
		expect(parseViewerEvent("")).toBeUndefined();
		expect(parseViewerEvent("{not-json")).toBeUndefined();
		expect(parseViewerEvent('{"suite":"smoke"}')).toBeUndefined();
		expect(parseViewerEventLines('{"type":"run_started","runId":"1"}\n\nbad\n')).toEqual([
			{ type: "run_started", runId: "1" },
		]);
	});
});
