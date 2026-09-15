#!/usr/bin/env node

import { resolve } from "node:path";

import {
	cleanupStagingSession,
	createLiveStagingSessionId,
	runAllSuites,
} from "../packages/test/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const totalRuns = 20;
const rows = new Map();
const forbidden = new Set(["worktree_leak", "recording_error", "judge_parse"]);
let fatalFailure;

for (let run = 1; run <= totalRuns; run += 1) {
	const stagingSessionId = createLiveStagingSessionId();
	try {
		const reports = await runAllSuites({
			cwd: root,
			suitesDir: "agent-suites",
			filter: "test-sdk-capabilities",
			host: "cursor",
			judge: true,
			worktree: true,
			stagingSessionId,
			workers: 1,
		});
		for (const result of reports.flatMap((report) => report.results)) {
			const row = rows.get(result.scenario) ?? { behavior: 0, infrastructure: 0, judge: 0, runs: 0 };
			row.runs += 1;
			const categories = new Set(result.failures.map((failure) => failure.category));
			if (!categories.has("rubric_miss")) row.behavior += 1;
			if (![...categories].some((category) => category !== "rubric_miss")) row.infrastructure += 1;
			if (result.judgeVerdicts?.length) {
				if (result.judgeVerdicts.every((verdict) => verdict.pass)) row.judge += 1;
			}
			const bad = [...categories].find((category) => forbidden.has(category));
			if (bad) fatalFailure = `${result.scenario} reported ${bad} on run ${run}`;
			rows.set(result.scenario, row);
		}
	} finally {
		await cleanupStagingSession(stagingSessionId);
	}
	console.log(`Capability run ${run}/${totalRuns} finished.`);
}

const failures = [];
for (const [scenario, row] of rows) {
	if (row.runs !== totalRuns) failures.push(`${scenario}: ran ${row.runs} times`);
	if (row.behavior < 19) failures.push(`${scenario}: ${row.behavior}/20 runs had no behavior failure`);
	if (row.infrastructure < 19) failures.push(`${scenario}: ${row.infrastructure}/20 runs had no infrastructure failure`);
	if (scenario === "scores a judge question" && row.judge < 19) failures.push(`${scenario}: ${row.judge}/20 judge passes`);
	console.log(`${scenario}: behavior ${row.behavior}/20, infrastructure ${row.infrastructure}/20${row.judge ? `, judge ${row.judge}/20` : ""}`);
}
if (rows.size !== 11) failures.push(`Expected 11 scenarios but measured ${rows.size}.`);
if (fatalFailure) failures.push(fatalFailure);
if (failures.length) throw new Error(`Reliability qualification failed:\n${failures.join("\n")}`);
console.log("Reliability qualification passed.");
