import { describe, expect, it } from "bun:test";

import { truncateViewerText, viewerContextFiles } from "../viewer/context-files.js";

describe("viewerContextFiles", () => {
	it("splits a marked preamble into files", () => {
		expect(
			viewerContextFiles(
				"<!-- brief.md -->\nDEPTH_CONTEXT token: agent-test-depth-context-6d2a",
				["brief.md"],
				["brief.md"],
			),
		).toEqual([
			{
				path: "brief.md",
				text: "DEPTH_CONTEXT token: agent-test-depth-context-6d2a",
				reason: "contextSources",
				why: "The scenario lists brief.md in contextSources.",
			},
		]);
	});

	it("keeps a fallback path when a chunk has no marker", () => {
		expect(viewerContextFiles("plain preamble", ["AGENTS.md"])).toEqual([
			{
				path: "AGENTS.md",
				text: "plain preamble",
				reason: "profile",
				why: "The host profile loaded AGENTS.md.",
			},
		]);
	});

	it("truncates a long file", () => {
		const text = truncateViewerText("a".repeat(12), 8);
		expect(text.startsWith("aaaaaaaa")).toBe(true);
		expect(text).toContain("truncated");
	});
});
