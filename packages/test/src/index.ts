export type { HostAdapter } from "@post-print/agent-harness";
export { registerHostAdapter, resolveAllowUserSkills } from "@post-print/agent-harness";
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
	disallowedShellSegments,
	shellCommandAllowed,
	splitShellSegments,
} from "./command-allowlist.js";
export {
	applyCompareArm,
	applySidecarCompareDurations,
	assertCompareGates,
	attachCompareStoryResults,
	buildCompareResult,
	compareArmDescription,
	compareArmLabel,
	compareArmTokens,
	compareArmTools,
	compareArmTurns,
	compareMetricValue,
	compareResultArms,
	compareStoryFields,
	describeCompareOutcome,
	evaluateCompareGates,
	mergeArmRubric,
	parseCompareArmId,
	plainDescription,
	prefixCompareFailures,
	requireCompareArm,
	resolveCompareArms,
} from "./compare-scenario.js";
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
	renderHtmlReport,
	reportCss,
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
	type LiveCompareArmSidecar,
	type LiveScenarioResultSidecar,
	loadStagingResult,
	recordTrace,
	resolveRecordingPath,
	scenarioArtifactSlug,
	setLiveStagingRootOverride,
	writeStagingResult,
} from "./record-trace.js";
export {
	collectCompareJudgeCriteria,
	collectJudgeCriteria,
	discoverSuites,
	judgeAuthRequired,
	type RunAgentTestOptions,
	type RunSuiteOptions,
	runAgentTest,
	runAllSuites,
	runSuite,
	scenarioNeedsJudge,
	selectedRunNeedsJudge,
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
	CompareArm,
	CompareArmId,
	CompareArmResult,
	CompareGate,
	CompareGateOperator,
	CompareGateResult,
	CompareJudgeMetric,
	CompareMetric,
	ContextMode,
	FailureCategory,
	JudgeRubricItem,
	JudgeVerdictResult,
	McpServerConfig,
	RunSummary,
	ScenarioCompare,
	ScenarioCompareResult,
	ScenarioContextFile,
	ScenarioContextReason,
	ScenarioResult,
	ScenarioRubric,
	ScenarioStory,
	ScenarioUsageBreakdown,
	StoryCheck,
	StoryCheckStatus,
	StorySection,
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
	resolveScenarioWorkspaceRel,
	type SuiteValidationReport,
	validateSuiteFile,
	validateSuitePaths,
} from "./validate-suite.js";
export {
	expandViewerJobs,
	loadViewerCatalog,
	type ViewerCatalog,
	type ViewerCatalogArm,
	type ViewerCatalogScenario,
	type ViewerCatalogSuite,
	type ViewerJob,
	type ViewerRunRequest,
} from "./viewer/catalog.js";
export { encodeViewerEvent, parseViewerEvent, type ViewerEvent } from "./viewer/events.js";
export { listenViewer } from "./viewer/server.js";
export {
	DEFAULT_CLI_WORKERS,
	DEFAULT_VIEWER_WORKERS,
	MAX_WORKERS,
	parseWorkerCount,
	runWorkerPool,
} from "./worker-pool.js";
