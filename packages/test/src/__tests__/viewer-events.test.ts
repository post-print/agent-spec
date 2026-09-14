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

	it("ignores blank and invalid lines", () => {
		expect(parseViewerEvent("")).toBeUndefined();
		expect(parseViewerEvent("{not-json")).toBeUndefined();
		expect(parseViewerEvent('{"suite":"smoke"}')).toBeUndefined();
		expect(parseViewerEventLines('{"type":"run_started","runId":"1"}\n\nbad\n')).toEqual([
			{ type: "run_started", runId: "1" },
		]);
	});
});
