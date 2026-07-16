export { assertRubric, expectTrace, TraceAssertion } from "./expect.js";
export { type HtmlReportMeta, renderHtmlReport, writeHtmlReport } from "./html-report.js";
export { loadSuiteFile } from "./load-suite.js";
export { assertLiveDogfoodPreflight } from "./preflight.js";
export {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRoot,
	getLiveStagingSessionRoot,
	getStagingResultPath,
	type LiveScenarioResultSidecar,
	loadStagingResult,
	type RecordingPathKind,
	type ResolvedRecordingPath,
	recordTrace,
	resolveRecordingPath,
	writeStagingResult,
} from "./record-trace.js";
export {
	discoverSuites,
	type RunSuiteOptions,
	runAllSuites,
	runSuite,
} from "./run-suite.js";
export type {
	AgentScenario,
	AgentSuiteFile,
	AssertionFailure,
	JudgeRubricItem,
	JudgeVerdictResult,
	McpServerConfig,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";
