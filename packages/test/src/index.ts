export {
	buildRerunCommand,
	collectDebugEnvironment,
	type DebugEnvironmentSnapshot,
	type DebugRerunOptions,
	formatDebugSummaryMarkdown,
	formatDebugWhySection,
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
	scenarioArtifactSlug,
	setLiveStagingRootOverride,
	writeStagingResult,
} from "./record-trace.js";
export {
	discoverSuites,
	type RunSuiteOptions,
	runAllSuites,
	runSuite,
} from "./run-suite.js";
export {
	type FailOnMode,
	formatRunSummary,
	shouldFailScenario,
	summarizeFailures,
	summarizeReportResults,
	summarizeReports,
} from "./suite-summary.js";
export type {
	AgentScenario,
	AgentSuiteFile,
	AssertionFailure,
	FailureCategory,
	JudgeRubricItem,
	JudgeVerdictResult,
	McpServerConfig,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types.js";
export {
	formatSeedValidationReport,
	type SeedValidationReport,
	validateSeedPatches,
} from "./validate-seeds.js";
export {
	formatValidationReport,
	type SuiteValidationReport,
	validateSuiteFile,
	validateSuitePaths,
} from "./validate-suite.js";
