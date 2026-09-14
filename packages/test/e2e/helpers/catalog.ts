import type { ViewerCatalog } from "../../src/viewer/catalog.js";

/** In-memory catalog. Covers skip, host pin, context, and compare layouts. */
export const e2eCatalog: ViewerCatalog = {
	suitesDir: "/tmp/agent-test-e2e-suites",
	defaultSelectedHosts: ["cursor"],
	suites: [
		{
			name: "smoke",
			description: "Minimal suite for the viewer.",
			hosts: ["cursor", "claude", "openai"],
			scenarios: [
				{
					name: "hello",
					description: "Plain reply.",
					prompt: "Reply with smoke. <script>window.__xss=1</script>",
					rubric: { must: ["smoke"], judge: ["Was the reply useful?"] },
				},
				{
					name: "pinned",
					prompt: "Only Claude runs this cell.",
					host: "claude",
					rubric: { must: ["claude"] },
				},
				{
					name: "skipped",
					prompt: "Do not run this cell.",
					skip: true,
					rubric: {},
				},
				{
					name: "context brief",
					prompt: "Use the brief.",
					rubric: { mustReadPath: ["brief.md"] },
					contextSources: ["brief.md"],
				},
			],
		},
		{
			name: "judge",
			description: "Compare suite.",
			hosts: ["cursor", "claude"],
			scenarios: [
				{
					name: "pair",
					description: "Two workspace arms.",
					prompt: "Read word.txt.",
					rubric: { mustReadPath: ["word.txt"] },
					compare: [
						{
							id: "a",
							label: "alpha",
							description: 'Alpha workspace. <img onerror="window.__arm=1">',
							prompt: "Read word.txt. Reply alpha.",
						},
						{
							id: "b",
							label: "beta",
							description: "Beta workspace.",
						},
					],
				},
				{
					name: "four arms",
					prompt: "Answer from the catalog.",
					rubric: {},
					compare: [
						{ id: "skel-clean", label: "skeleton clean" },
						{ id: "none-clean", label: "no skill clean" },
						{ id: "skel-messy", label: "skeleton messy" },
						{ id: "none-messy", label: "no skill messy" },
					],
					faster: [{ winner: "skel-clean", loser: "none-messy" }],
					cheaper: [
						{ winner: "skel-clean", loser: "none-clean" },
						{ winner: "skel-messy", loser: "none-messy" },
					],
				},
			],
		},
	],
};
