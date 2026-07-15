export { assertRubric, expectTrace, TraceAssertion } from "./expect";

export { loadSuiteFile } from "./load-suite";
export { assertLiveDogfoodPreflight } from "./preflight";
export {
	cleanupLegacyRepoRecordings,
	cleanupStagingSession,
	createLiveStagingSessionId,
	getLiveStagingRoot,
	getLiveStagingSessionRoot,
	type RecordingPathKind,
	type ResolvedRecordingPath,
	recordTrace,
	resolveRecordingPath,
} from "./record-trace";
export { discoverSuites, type RunSuiteOptions, runAllSuites, runSuite } from "./run-suite";
export type {
	AgentScenario,
	AgentSuiteFile,
	AssertionFailure,
	JudgeRubricItem,
	ScenarioResult,
	ScenarioRubric,
	SuiteRunReport,
} from "./types";
