export {
	type ComparePairSpec,
	compareSuiteReports,
	formatCompareReportMarkdown,
	labelForCompareSide,
	loadSuiteRunReport,
	metricsFromResult,
	parseComparePairToken,
	type ScenarioCompareDelta,
	type ScenarioCompareMetrics,
	type SuiteCompareReport,
	type WriteCompareReportOptions,
	writeCompareReport,
} from "./compare.js";
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
export {
	type HtmlReportMeta,
	renderCompareHtmlReport,
	renderCompareHtmlSection,
	renderHtmlReport,
	writeHtmlReport,
} from "./html-report.js";
export {
	applyExternalRubrics,
	type LoadSuiteOptions,
	loadSuiteFile,
	parseRubricsFile,
	resolveRubricsPath,
	type SuiteRubricsFile,
	suiteNameFromSuitePath,
} from "./load-suite.js";
export { assertDirectAgentPreflight } from "./preflight.js";
export {
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRoot,
	getLiveStagingRootOverride,
	getLiveStagingSessionRoot,
	getStagingResultPath,
	type LiveScenarioResultSidecar,
	loadStagingResult,
	recordTrace,
	resolveRecordingPath,
	scenarioArtifactSlug,
	scenarioCompareKey,
	setLiveStagingRootOverride,
	writeStagingResult,
} from "./record-trace.js";
export {
	discoverSuites,
	type RunAgentTestOptions,
	type RunSuiteOptions,
	runAgentTest,
	runAllSuites,
	runSuite,
} from "./run-suite.js";
export {
	ANNOUNCE_STOP_MATCHERS,
	resolveScenarioRetryMaxAttempts,
	shouldRetryAnnounceStopFlake,
} from "./scenario-retry.js";
export {
	buildScenarioResultUsage,
	judgeUsageFromVerdicts,
	totalTokensFromScenarioUsage,
} from "./scenario-usage.js";
export {
	type FailOnMode,
	formatRunSummary,
	formatUsageStats,
	percentileNearestRank,
	shouldFailScenario,
	summarizeFailures,
	summarizeReportResults,
	summarizeReports,
	summarizeUsage,
} from "./suite-summary.js";
export type {
	AgentScenario,
	AgentSuiteDefaults,
	AgentSuiteFile,
	AgentUsage,
	AssertionFailure,
	FailureCategory,
	JudgeRubricItem,
	JudgeVerdictResult,
	McpServerConfig,
	RunSummary,
	ScenarioResult,
	ScenarioRubric,
	ScenarioUsageBreakdown,
	SuiteRunReport,
	UsageStats,
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
