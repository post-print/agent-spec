#!/usr/bin/env node

import { resolve } from "node:path";

import { runAgentTest } from "../packages/test/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const selected = process.argv.includes("--host") ? [process.argv[process.argv.indexOf("--host") + 1]] : ["cursor", "claude", "openai"];

for (const host of selected) {
	if (!host) throw new Error("--host needs a host name.");
	const result = await runAgentTest({
		cwd: root,
		host,
		judge: false,
		worktree: true,
		scenarioRetries: 0,
		scenario: {
			name: `${host} reads one file`,
			workspace: "agent-suites/fixtures/task-list",
			prompt: "Read PROJECT.md. Reply with the project owner only.",
			rubric: { must: ["Mina"], mustReadPath: ["PROJECT.md"] },
		},
	});
	if (!result.passed || !result.trace?.toolCalls.some((call) => JSON.stringify(call).includes("PROJECT.md"))) {
		throw new Error(`${host} did not pass the direct SDK smoke test.`);
	}
	console.log(`${host}: direct SDK smoke passed`);
}
