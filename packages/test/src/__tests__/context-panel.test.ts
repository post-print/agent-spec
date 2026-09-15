import { describe, expect, it } from "bun:test";

import { contextFileCountLabel, renderContextPanel } from "../context-panel.js";
import type { ScenarioContextFile } from "../types.js";

const brief: ScenarioContextFile = {
	path: "brief.md",
	text: "DEPTH_CONTEXT token: agent-test-depth-context-6d2a",
	reason: "contextSources",
	why: "The scenario lists brief.md in contextSources.",
};

describe("renderContextPanel", () => {
	it("renders an empty preamble state", () => {
		const html = renderContextPanel([], "harness-preamble", "\n\n---\nTask:\nSay hi");
		expect(html).toContain('class="context-panel"');
		expect(html).toContain("Context delivery");
		expect(html).toContain("Harness preamble · 0 files");
		expect(html).toContain("Exact submitted user input");
		expect(html).toContain("Task:\nSay hi");
		expect(html).toContain("No preamble files. The agent received the prompt only.");
		expect(html).not.toContain("context-files");
	});

	it("renders each preamble file with why and exact text", () => {
		const html = renderContextPanel([
			brief,
			{
				path: "skills/catalog",
				text: "See <note.md> and & more",
				reason: "skills",
				why: "The scenario skills setting loaded skills/catalog.",
			},
		]);
		expect(html).toContain("2 files");
		expect(html).toContain("These files were in the host preamble for this run.");
		expect(html).toContain("brief.md");
		expect(html).toContain("The scenario lists brief.md in contextSources.");
		expect(html).toContain("DEPTH_CONTEXT token: agent-test-depth-context-6d2a");
		expect(html).toContain("skills/catalog");
		expect(html).toContain('data-reason="skills"');
		expect(html).toContain("See &lt;note.md&gt; and &amp; more");
	});

	it("opens a single file so the body is visible", () => {
		expect(renderContextPanel([brief])).toContain('<details class="context-file" open');
		expect(contextFileCountLabel(1)).toBe("1 file");
	});

	it("shows exact submitted input without claiming native host internals", () => {
		const html = renderContextPanel([], "host-native", "Review this change.");
		expect(html).toContain('data-context-mode="host-native"');
		expect(html).toContain("Host-native");
		expect(html).toContain("Host discovery");
		expect(html).toContain("Review this change.");
		expect(html).toContain("not exposed as one inspectable payload");
	});
});
