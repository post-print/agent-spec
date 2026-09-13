export type { HostAdapter } from "@post-print/agent-harness";
export { registerHostAdapter } from "@post-print/agent-harness";
export {
	type CheckOptions,
	type CheckReport,
	collectSuiteHosts,
	formatCheckReport,
	formatCheckSummary,
	missingHostsAuth,
	runCheck,
} from "./check.js";
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
export { missingAgentAuth, runDoctor } from "./doctor.js";
export { assertRubric, expectTrace, TraceAssertion } from "./expect.js";
export { assertionFailure } from "./failures.js";
export {
	parseHostList,
	resolveSuiteHosts,
	scenarioRunsOnHost,
	uniqueHosts,
} from "./hosts.js";
export {
	type HtmlReportMeta,
	renderCompareHtmlReport,
	renderCompareHtmlSection,
	renderHtmlReport,
	writeHtmlReport,
} from "./html-report.js";
export { defineConfig, loadHostAdapters } from "./load-adapters.js";
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
	collectJudgeCriteria,
	discoverSuites,
	judgeAuthRequired,
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
	buildScenarioStory,
	describeOutcome,
	describeRubricChecks,
	describeTraceHappened,
} from "./scenario-story.js";
export {
	buildScenarioResultUsage,
	judgeUsageFromVerdicts,
	totalTokensFromScenarioUsage,
} from "./scenario-usage.js";
export {
	type FailOnMode,
	formatRunSummary,
	formatTokenCount,
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
	ScenarioStory,
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
