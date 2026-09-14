import { describe, expect, it } from "bun:test";

import type { ViewerCatalog } from "../viewer/catalog.js";
import { renderViewerPage } from "../viewer/page.js";

const threeHostCatalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "tools",
			hosts: ["cursor", "claude", "openai"],
			scenarios: [
				{
					name: "needle",
					prompt: "Read needle.txt.",
					rubric: { mustReadPath: ["needle.txt"] },
				},
			],
		},
	],
};

const fourArmCatalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "judge",
			hosts: ["cursor"],
			scenarios: [
				{
					name: "four arms",
					prompt: "Read word.txt. Reply with only that word.",
					rubric: { mustReadPath: ["word.txt"] },
					compare: [
						{ id: "skel-clean", label: "skeleton clean" },
						{ id: "none-clean", label: "no skill clean" },
						{ id: "skel-messy", label: "skeleton messy" },
						{ id: "none-messy", label: "no skill messy" },
					],
				},
			],
		},
	],
};

describe("viewer page", () => {
	it("renders host tabs and an inline result hook", () => {
		const html = renderViewerPage(threeHostCatalog);
		expect(html).toContain("host-tablist");
		expect(html).toContain('data-scenario-card="tools::needle"');
		expect(html).toContain("selectHostTab");
		expect(html).toContain("cell-result");
		expect(html).toContain("Run selected hosts");
		expect(html).toContain('data-host-panel="cursor"');
		expect(html).toContain('data-host-panel="openai"');
		expect(html).toContain("No run yet.");
		expect(html).not.toContain('class="matrix"');
	});

	it("embeds tab switcher script for n-arm compares", () => {
		const html = renderViewerPage(fourArmCatalog);
		expect(html).toContain("skeleton clean");
		expect(html).toContain("no skill messy");
		expect(html).toContain("compare-tablist");
		expect(html).toContain("selectCompareTab");
		expect(html).toContain("dataset.userPicked");
		expect(html).toContain("compare-tabs");
		expect(html).toContain("displayToolPath");
		expect(html).toContain("chat-running");
		expect(html).toContain("hideAllRunning");
		expect(html).toContain("appendContextFiles");
		expect(html).toContain("context-why");
		expect(html.split("scrollIntoView").length - 1).toBe(1);
		expect(html).toContain("dataset.followHost");
		expect(html).toContain("startChat");
		expect(html).toContain("closeAllChats");
		expect(html).toContain("cancelOpenChats");
		expect(html).toContain("Cancelling the run.");
		expect(html).toContain("Run cancelled.");
		expect(html).toContain("chatIsOpen");
	});
});
