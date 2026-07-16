export {
	buildRerunCommand,
	collectDebugEnvironment,
	type DebugEnvironmentSnapshot,
	type DebugRerunOptions,
	formatTranscriptMarkdown,
	getDebugBundleDir,
	shellQuote,
	type WriteDebugBundleOptions,
	writeDebugBundle,
} from "./debug-bundle.js";
export { assertRubric, expectTrace, TraceAssertion } from "./expect.js";
export { assertionFailure } from "./failures.js";
export { type HtmlReportMeta, renderHtmlReport, writeHtmlReport } from "./html-report.js";
export { loadSuiteFile } from "./load-suite.js";
export { assertLiveDogfoodPreflight } from "./preflight.js";
export {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRoot,
	getLiveStagingRootOverride,
	getLiveStagingSessionRoot,
	getStagingResultPath,
	type LiveScenarioResultSidecar,
	loadStagingResult,
	type RecordingPathKind,
	type ResolvedRecordingPath,
	recordTrace,
	resolveRecordingPath,
	setLiveStagingRootOverride,
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
	FailureCategory,
	JudgeRubricItem,
	JudgeVerdictResult,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";
