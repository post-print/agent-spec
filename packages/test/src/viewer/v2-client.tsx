import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	useNavigate,
} from "@tanstack/react-router";
import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import Markdown from "react-markdown";
import {
	assertionComparison,
	conversationPlaceholder,
	formatRunDate,
	median,
	preferredTestExecutionId,
	stripAnsi,
	type TestRunStatus,
	testRunStatus,
	unwrapShellCommand,
} from "./presentation.js";
import { RunInboxPage, RunPage } from "./run-inbox.js";
import type { DiscoveredTest as TestRecord } from "./test-catalog.js";
import { type ToolImage, ToolImages, toolImages } from "./tool-images.js";
import {
	cancelExecution,
	type ExecutionSummary,
	fetchExecution as fetchExecutionRecord,
	startSuite,
	startTest,
	startTestGroup,
	useCatalog,
	useExecutionHistory,
} from "./viewer-queries.js";

type TestStatusValue = TestRunStatus;
type Attempt = {
	testId?: string;
	id: string;
	title: string[];
	project?: string;
	status: string;
	errors: Array<{ message?: string }>;
	criterionResults: Array<{
		criterion: string;
		status: "passed" | "failed" | "not-recorded";
		assertion?: string;
	}>;
	output: { stdout: string[]; stderr: string[] };
	operations: Array<{
		id: string;
		kind: string;
		name?: string;
		status: string;
		invocationIndex?: number;
		data: unknown[];
	}>;
};
type ExecutionDetail = ExecutionSummary & { attempts: Attempt[]; cancellable?: boolean };
const fetchExecution = (id: string) => fetchExecutionRecord<ExecutionDetail>(id);
type TestView = "current" | "setup" | "history";
const LOCAL_PATH_LINK = /\[([^\]]+)\]\(<local-path>[^)]*\)/g;

const runningPulse = stylex.keyframes({
	"0%, 60%, 100%": { opacity: 0.3, transform: "translateY(0)" },
	"30%": { opacity: 1, transform: "translateY(-2px)" },
});
const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;
const INITIAL_CHARACTER = /^./;
const NARROW_VIEWER_QUERY = "(max-width: 820px)";
const WorkerContext = createContext<{
	workers: number;
	setWorkers: (workers: number) => void;
}>({ workers: 1, setWorkers: () => undefined });

const rootRoute = createRootRoute({ component: ViewerLayout });
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: RunInboxPage,
});
const testRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/tests/$testId",
	validateSearch: (search: Record<string, unknown>): { execution?: string; view?: TestView } => ({
		execution: typeof search.execution === "string" ? search.execution : undefined,
		view:
			search.view === "setup" || search.view === "history" || search.view === "current"
				? search.view
				: undefined,
	}),
	component: TestPage,
});
const executionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/executions/$executionId",
	component: ExecutionRunPage,
});
const compareRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/compare/$left/$right",
	component: ComparePage,
});
export const viewerRouter = createRouter({
	routeTree: rootRoute.addChildren([indexRoute, testRoute, executionRoute, compareRoute]),
});

const styles = stylex.create({
	skipLink: {
		position: "fixed",
		top: "0.75rem",
		left: "0.75rem",
		zIndex: 10,
		padding: "0.55rem 0.75rem",
		borderRadius: 8,
		backgroundColor: "var(--accent)",
		color: "oklch(0.18 0.03 175)",
		fontSize: "0.8rem",
		fontWeight: 750,
		textDecoration: "none",
		transform: { default: "translateY(-200%)", ":focus": "translateY(0)" },
		transition: {
			default: "transform 120ms ease",
			"@media (prefers-reduced-motion: reduce)": "none",
		},
	},
	shell: {
		display: "grid",
		gridTemplateColumns: {
			default: "18rem minmax(0, 1fr)",
			"@media (max-width: 820px)": "14rem minmax(0, 1fr)",
		},
		height: "100dvh",
		minHeight: 0,
	},
	shellNarrow: { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "auto minmax(0, 1fr)" },
	shellCollapsed: { gridTemplateColumns: "3.75rem minmax(0, 1fr)" },
	sidebar: {
		borderRight: "1px solid var(--border)",
		overflow: "hidden",
		display: "flex",
		flexDirection: "column",
		padding: "1rem 0 0",
		backgroundColor: "var(--sidebar)",
		minHeight: 0,
		height: "100dvh",
	},
	sidebarCollapsed: { paddingTop: "1rem", height: "100dvh", maxHeight: "none" },
	mobileHeader: {
		position: "sticky",
		top: 0,
		zIndex: 2,
		display: "flex",
		alignItems: "center",
		gap: "0.75rem",
		minWidth: 0,
		padding: "0.65rem 0.85rem",
		borderBottom: "1px solid var(--border)",
		backgroundColor: "var(--sidebar)",
	},
	mobileMenuButton: {
		width: "2.75rem",
		height: "2.75rem",
		padding: 0,
		borderRadius: 9,
		backgroundColor: { default: "var(--panel-2)", ":hover": "var(--panel-3)" },
		color: "var(--text)",
		fontSize: "1.15rem",
		cursor: "pointer",
	},
	mobileHeaderIdentity: { display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 },
	mobileHeaderTitle: { fontSize: "1rem", fontWeight: 720, letterSpacing: "-0.02em" },
	mobileDrawerDialog: {
		width: "min(22rem, calc(100vw - 2.75rem))",
		maxWidth: "none",
		height: "100dvh",
		maxHeight: "none",
		margin: 0,
		padding: 0,
		borderWidth: 0,
		backgroundColor: "var(--sidebar)",
		color: "var(--text)",
		overflow: "hidden",
	},
	mobileDrawerSurface: {
		display: "flex",
		flexDirection: "column",
		height: "100%",
		minHeight: 0,
		paddingTop: "1rem",
		backgroundColor: "var(--sidebar)",
		boxShadow: "0 1rem 3rem oklch(0.06 0.02 258 / 0.45)",
	},
	main: {
		overflow: "auto",
		minWidth: 0,
		padding: {
			default: "2rem clamp(1.5rem, 3vw, 3rem) 3rem",
			"@media (max-width: 820px)": "1.5rem 1.25rem 3rem",
			"@media (max-width: 620px)": "1rem 0.85rem 2rem",
		},
		maxWidth: "88rem",
		width: "100%",
		margin: "0 auto",
	},
	brand: {
		color: "var(--accent)",
		fontSize: "0.66rem",
		fontWeight: 750,
		letterSpacing: "0.11em",
		textTransform: "uppercase",
	},
	sidebarHeader: {
		display: "grid",
		gap: "0.65rem",
		padding: "0 0.45rem 1rem",
		margin: "0 0.8rem",
		borderBottom: "1px solid var(--border)",
	},
	sidebarHeaderCollapsed: {
		padding: 0,
		margin: 0,
		borderBottom: 0,
		display: "flex",
		justifyContent: "center",
	},
	toggleButton: {
		width: "1.85rem",
		height: "1.85rem",
		display: "inline-grid",
		placeItems: "center",
		flex: "none",
		padding: 0,
		borderRadius: 8,
		backgroundColor: {
			default: "var(--panel-2)",
			":hover": "var(--panel-3)",
			":active": "var(--panel-3)",
		},
		color: "var(--text)",
		cursor: "pointer",
		fontSize: "0.95rem",
		lineHeight: 1,
		boxShadow: "none",
	},
	mobileCloseButton: { width: "2.75rem", height: "2.75rem", fontSize: "1.15rem" },
	sidebarTitleRow: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
	},
	sidebarTitleIdentity: { display: "flex", alignItems: "center", gap: "0.65rem" },
	suiteRunButton: {
		width: "fit-content",
		minHeight: "1.8rem",
		padding: "0.3rem 0.55rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--border)",
		borderRadius: 8,
		backgroundColor: {
			default: "var(--panel-2)",
			":hover": "var(--panel-3)",
			":disabled": "var(--panel-2)",
		},
		color: "var(--text)",
		cursor: { default: "pointer", ":disabled": "wait" },
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.45rem",
		fontSize: "0.7rem",
		fontWeight: 700,
	},
	suiteControls: {
		display: "grid",
		gridTemplateColumns: "max-content minmax(0, 1fr)",
		alignItems: "center",
		columnGap: "0.75rem",
	},
	workerControl: {
		display: "flex",
		alignItems: "center",
		justifySelf: "end",
		gap: "0.35rem",
		color: "var(--muted)",
		fontSize: "0.68rem",
		fontWeight: 650,
	},
	workerInput: {
		width: "2.8rem",
		height: "1.8rem",
		padding: "0.25rem 0.35rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":focus": "var(--accent)" },
		borderRadius: 7,
		backgroundColor: "var(--panel-2)",
		color: "var(--text)",
		fontSize: "0.72rem",
		fontVariantNumeric: "tabular-nums",
		outline: "none",
	},
	groupHeaderActions: { display: "flex", alignItems: "center", gap: "0.4rem" },
	groupRunButton: {
		width: "1.45rem",
		height: "1.45rem",
		padding: 0,
		borderRadius: 6,
		backgroundColor: { default: "transparent", ":hover": "var(--panel-3)" },
		color: "var(--accent)",
		cursor: { default: "pointer", ":disabled": "wait" },
		fontSize: "0.62rem",
		lineHeight: 1,
	},
	countBadge: {
		padding: "0.22rem 0.55rem",
		borderRadius: 999,
		backgroundColor: "var(--panel-3)",
		color: "var(--muted)",
		fontSize: "0.72rem",
		fontWeight: 700,
		fontVariantNumeric: "tabular-nums",
	},
	title: {
		margin: 0,
		fontSize: { default: "clamp(1.08rem, 1.5vw, 1.3rem)", "@media (max-width: 620px)": "1.08rem" },
		lineHeight: 1.18,
		letterSpacing: "-0.025em",
		fontWeight: 720,
	},
	sidebarTitle: { fontSize: "1.08rem" },
	sectionTitle: { margin: 0, fontSize: "0.92rem", letterSpacing: "-0.01em" },
	section: { display: "grid", gap: "0.75rem", marginTop: "1.5rem" },
	list: { display: "grid", gap: "0.45rem" },
	card: {
		border: "1px solid var(--border)",
		borderRadius: 14,
		backgroundColor: "var(--panel-2)",
		padding: "0.75rem",
	},
	link: { color: "var(--text)", textDecoration: "none" },
	buttonReset: {
		appearance: "none",
		borderWidth: 0,
		borderStyle: "solid",
		borderColor: "transparent",
		outlineWidth: { default: 0, ":focus-visible": 2 },
		outlineStyle: "solid",
		outlineColor: "var(--accent)",
		outlineOffset: 2,
	},
	button: {
		minHeight: "2.5rem",
		padding: "0.6rem 0.95rem",
		borderRadius: 8,
		backgroundColor: {
			default: "var(--accent)",
			":hover": "oklch(0.82 0.14 175)",
			":active": "oklch(0.72 0.14 175)",
		},
		color: "oklch(0.18 0.03 175)",
		fontSize: "0.82rem",
		fontWeight: 720,
		letterSpacing: "0.01em",
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		gap: "0.4rem",
		cursor: "pointer",
		boxShadow: "0 1px 2px oklch(0.08 0.02 258 / 0.35)",
		transition: "background-color 120ms ease, border-color 120ms ease, transform 120ms ease",
		transform: { default: "translateY(0)", ":active": "translateY(1px)" },
	},
	secondaryButton: {
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":hover": "var(--border-strong)" },
		backgroundColor: {
			default: "var(--panel-2)",
			":hover": "var(--panel-3)",
			":active": "var(--panel)",
		},
		color: "var(--text)",
		boxShadow: "none",
	},
	buttonIcon: { fontSize: "0.68rem", opacity: 0.8 },
	navigation: {
		overflow: "auto",
		minHeight: 0,
		padding: "0.75rem 0.65rem 1rem",
		display: "grid",
		alignContent: "start",
		gap: "0.75rem",
	},
	navSection: {
		display: "grid",
		gap: "0.18rem",
		padding: "0.35rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--border)",
		borderRadius: 10,
		backgroundColor: "var(--bg)",
	},
	groupHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
		padding: "0.48rem 0.52rem 0.55rem",
		borderBottom: "1px solid var(--border)",
		marginBottom: "0.08rem",
	},
	groupLabel: {
		color: "var(--text)",
		fontSize: "0.66rem",
		fontWeight: 780,
		letterSpacing: "0.08em",
		textTransform: "uppercase",
	},
	groupCount: { color: "var(--subtle)", fontSize: "0.66rem", fontVariantNumeric: "tabular-nums" },
	navLink: {
		display: "block",
		padding: "0.55rem 0.6rem",
		borderRadius: 8,
		fontSize: "0.78rem",
		fontWeight: 540,
		lineHeight: 1.38,
		color: "var(--muted)",
		textDecoration: "none",
		border: "1px solid transparent",
		backgroundColor: { default: "transparent", ":hover": "var(--panel)" },
	},
	batchRunLink: {
		justifySelf: "start",
		marginTop: "0.75rem",
		color: { default: "var(--muted)", ":hover": "var(--text)" },
		fontSize: "0.78rem",
		textDecoration: "none",
	},
	runsLink: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 650 },
	navItemHeader: {
		display: "grid",
		gridTemplateColumns: "0.65rem minmax(0, 1fr)",
		alignItems: "flex-start",
		gap: "0.5rem",
	},
	navItemTitle: { minWidth: 0 },
	navStatus: {
		display: "grid",
		placeItems: "center",
		width: "0.65rem",
		height: "1.1rem",
	},
	navStatusDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "var(--muted)" },
	navStatusDotPass: { backgroundColor: "var(--pass)" },
	navStatusDotFail: { backgroundColor: "var(--fail)" },
	navStatusDotRunning: { backgroundColor: "var(--skip)", boxShadow: "0 0 0 3px var(--skip-soft)" },
	active: {
		backgroundColor: "var(--panel-2)",
		color: "var(--text)",
		borderColor: "transparent",
		boxShadow: "none",
	},
	hero: {
		padding: { default: "1.1rem 1.25rem", "@media (max-width: 620px)": "1rem" },
		border: "1px solid var(--border)",
		borderRadius: 12,
		backgroundColor: "var(--panel)",
		display: "grid",
		gap: "0.7rem",
		boxShadow: "0 10px 30px oklch(0.08 0.02 258 / 0.14)",
	},
	heroTop: {
		display: "grid",
		gridTemplateColumns: {
			default: "minmax(0, 1fr) max-content",
			"@media (max-width: 620px)": "1fr",
		},
		alignItems: "flex-start",
		gap: "1rem",
	},
	heroCopy: { display: "grid", gap: "0.35rem", maxWidth: "56rem", minWidth: 0 },
	heroAction: {
		justifySelf: { default: "end", "@media (max-width: 620px)": "start" },
		alignSelf: "start",
	},
	description: { color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.5, maxWidth: "54rem" },
	path: {
		color: "var(--subtle)",
		fontSize: "0.7rem",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		wordBreak: "break-word",
		paddingTop: "0.6rem",
		borderTopWidth: 1,
		borderTopStyle: "solid",
		borderTopColor: "var(--border)",
	},
	meta: { color: "var(--muted)", fontSize: "0.8rem", lineHeight: 1.45 },
	contextPanel: {
		border: "1px solid var(--border)",
		borderRadius: 12,
		backgroundColor: "var(--panel)",
		overflow: "hidden",
	},
	contextHeader: {
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: "1rem",
		padding: "0.75rem 0.9rem",
		borderBottom: "1px solid var(--border)",
	},
	contextIntro: { display: "grid", gap: "0.2rem" },
	resourceCount: { color: "var(--accent)", fontSize: "0.75rem", fontWeight: 700 },
	detailsBody: { padding: "0.75rem", display: "grid", gap: "0.6rem" },
	setupBody: { padding: "0.85rem 0.9rem", display: "grid", gap: "1.15rem" },
	setupSection: { display: "grid", gap: "0.55rem" },
	setupSectionHeader: {
		display: "flex",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: "1rem",
	},
	setupSectionCopy: { display: "grid", gap: "0.12rem" },
	resourceGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(auto-fill, minmax(min(17rem, 100%), 22rem))",
		gap: "0.6rem",
	},
	resourceCard: {
		display: "grid",
		alignContent: "start",
		gap: "0.5rem",
		padding: "0.7rem 0.75rem",
	},
	resourceHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
	},
	resourceKind: {
		color: "var(--accent)",
		backgroundColor: "var(--accent-soft)",
		borderRadius: 999,
		padding: "0.16rem 0.48rem",
		fontSize: "0.65rem",
		fontWeight: 750,
		textTransform: "uppercase",
		letterSpacing: "0.05em",
	},
	resourceBody: { display: "grid", gap: "0.5rem" },
	resourceFacts: { display: "grid", gap: "0.22rem" },
	resourceDescription: {
		color: "var(--text)",
		fontSize: "0.77rem",
		lineHeight: 1.5,
		margin: 0,
	},
	resourceFact: {
		display: "grid",
		gridTemplateColumns: "4.5rem minmax(0, 1fr)",
		gap: "0.65rem",
		alignItems: "baseline",
	},
	resourceFactLabel: {
		color: "var(--subtle)",
		fontSize: "0.7rem",
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: "0.04em",
	},
	resourceFactValue: { color: "var(--muted)", fontSize: "0.78rem", wordBreak: "break-word" },
	resourcePrompt: {
		marginTop: "0.5rem",
		padding: "0.55rem",
		borderRadius: 8,
		border: "1px solid var(--border)",
		backgroundColor: "var(--bg)",
		display: "grid",
		gap: "0.25rem",
	},
	disclosureIcon: { color: "var(--accent)", fontSize: "0.8rem" },
	workspaceRow: {
		padding: "0.65rem 0.75rem",
		border: "1px solid var(--border)",
		borderRadius: 9,
		backgroundColor: "var(--panel-2)",
		display: "grid",
		gap: "0.25rem",
	},
	tabList: {
		display: "flex",
		gap: "1.25rem",
		marginTop: "0.75rem",
		padding: "0 0.25rem",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "var(--border)",
		overflowX: "auto",
		overflowY: "hidden",
	},
	tab: {
		flex: "0 0 auto",
		minHeight: "2.35rem",
		marginBottom: -1,
		padding: "0.7rem 0.15rem 0.65rem",
		borderBottomWidth: 2,
		borderBottomColor: "transparent",
		borderRadius: 0,
		backgroundColor: "transparent",
		color: "var(--muted)",
		fontSize: "0.8rem",
		fontWeight: 680,
		cursor: "pointer",
		whiteSpace: "nowrap",
	},
	tabActive: {
		color: "var(--text)",
		borderBottomColor: "var(--accent)",
	},
	tabPanel: { marginTop: "0.7rem" },
	tabSection: { display: "grid", gap: "1rem" },
	historyList: { display: "grid", gap: "0.65rem", marginTop: "1rem" },
	historyButton: {
		width: "100%",
		padding: "0.65rem 0.8rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":hover": "var(--border-strong)" },
		borderRadius: 10,
		backgroundColor: { default: "var(--panel-2)", ":hover": "var(--panel-3)" },
		color: "var(--text)",
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "1rem",
		textAlign: "left",
	},
	historyIdentity: { display: "grid", gap: "0.2rem", minWidth: 0 },
	historyDate: { color: "var(--muted)", fontSize: "0.78rem" },
	historyId: {
		color: "var(--subtle)",
		fontSize: "0.72rem",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
	},
	sectionHeading: {
		display: "flex",
		alignItems: "flex-end",
		justifyContent: "space-between",
		gap: "1rem",
		flexWrap: "wrap",
	},
	quietHeader: {
		display: "flex",
		justifyContent: "flex-start",
		marginBottom: "0.75rem",
	},
	statusPanel: {
		display: "grid",
		gap: "0.85rem",
	},
	runControls: { display: "flex", justifyContent: "flex-end" },
	row: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" },
	attemptActions: { display: "flex", alignItems: "center", gap: "0.55rem", flex: "none" },
	copyFailureButton: {
		minHeight: "1.75rem",
		padding: "0.3rem 0.55rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--border)",
		borderRadius: 7,
		backgroundColor: { default: "var(--panel-2)", ":hover": "var(--panel-3)" },
		color: "var(--text)",
		fontSize: "0.68rem",
		fontWeight: 680,
		cursor: "pointer",
	},
	attemptCard: {
		border: "1px solid var(--border)",
		borderRadius: 12,
		backgroundColor: "var(--panel)",
		padding: "0.85rem",
		display: "grid",
		gap: "0.7rem",
	},
	attemptTitle: { fontSize: "0.84rem", lineHeight: 1.4 },
	verdictPanel: {
		display: "grid",
		gap: "0.55rem",
		padding: "0.7rem 0.8rem",
		borderRadius: 10,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--border)",
		backgroundColor: "var(--panel-2)",
	},
	verdictPass: { borderColor: "oklch(0.79 0.16 155 / 0.45)", backgroundColor: "var(--pass-soft)" },
	verdictFail: { borderColor: "oklch(0.73 0.18 25 / 0.5)", backgroundColor: "var(--fail-soft)" },
	verdictHeadline: { margin: 0, fontSize: "0.92rem", fontWeight: 720, color: "var(--text)" },
	verdictMetrics: {
		display: "grid",
		gridTemplateColumns: "repeat(auto-fit, minmax(7.5rem, 1fr))",
		gap: "0.4rem 1rem",
		margin: 0,
	},
	verdictMetric: { display: "grid", gap: "0.1rem", minWidth: 0 },
	verdictMetricValue: {
		display: "grid",
		margin: 0,
		color: "var(--text)",
		fontSize: "0.86rem",
		fontWeight: 650,
		fontVariantNumeric: "tabular-nums",
	},
	verdictMetricMedian: { color: "var(--subtle)", fontSize: "0.68rem", fontWeight: 500 },
	verdictPassedChecks: { display: "grid", gap: "0.45rem" },
	verdictCount: { color: "var(--muted)", fontWeight: 560 },
	resultPanel: {
		display: "grid",
		gap: "0.55rem",
		padding: "0.75rem",
		borderRadius: 10,
		backgroundColor: "var(--panel-2)",
		border: "1px solid var(--border)",
	},
	contentHeading: { margin: 0, fontSize: "0.79rem", color: "var(--text)" },
	resultOutput: {
		margin: 0,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		fontSize: "0.82rem",
		lineHeight: 1.6,
		color: "var(--text)",
	},
	assertionCard: {
		display: "grid",
		gap: "0.4rem",
		marginTop: "-0.1rem",
		marginLeft: "1.5rem",
		padding: "0.15rem 0 0.15rem 0.75rem",
		borderLeftWidth: 2,
		borderLeftStyle: "solid",
		borderLeftColor: "var(--fail)",
	},
	assertionTitle: { color: "var(--fail)", fontSize: "0.74rem" },
	assertionValues: {
		display: "grid",
		gap: "0.35rem",
		margin: 0,
	},
	assertionValue: {
		display: "grid",
		gridTemplateColumns: "5rem minmax(0, 1fr)",
		alignItems: "baseline",
		gap: "0.65rem",
	},
	assertionLabel: {
		color: "var(--subtle)",
		fontSize: "0.65rem",
		fontWeight: 750,
		letterSpacing: "0.05em",
		textTransform: "uppercase",
	},
	assertionCode: {
		margin: 0,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		fontSize: "0.75rem",
		lineHeight: 1.5,
		color: "var(--text)",
	},
	metricGrid: {
		display: "grid",
		gridTemplateColumns: "repeat(auto-fit, minmax(6rem, 1fr))",
		gap: "0.4rem",
	},
	metric: {
		display: "grid",
		gap: "0.15rem",
		padding: "0.5rem 0.6rem",
		borderRadius: 8,
		backgroundColor: "var(--bg)",
		border: "1px solid var(--border)",
	},
	metricValue: { color: "var(--text)", fontSize: "0.77rem", fontWeight: 700 },
	conversation: {
		display: "grid",
		gap: "0.55rem",
		padding: "0.2rem 0",
	},
	conversationSurface: {
		display: "grid",
		gap: "0.55rem",
		padding: "0.75rem",
		border: "1px solid var(--border)",
		borderRadius: 10,
		backgroundColor: "var(--bg)",
	},
	conversationSwitcher: {
		display: "flex",
		alignItems: "center",
		gap: "0.35rem",
		padding: "0 0.15rem",
	},
	conversationHeader: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "baseline",
		justifyContent: "flex-start",
		gap: "0.25rem 0.75rem",
	},
	sectionIntro: { margin: 0, color: "var(--subtle)", fontSize: "0.72rem", lineHeight: 1.4 },
	ranRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" },
	ranLabel: {
		color: "var(--subtle)",
		fontSize: "0.66rem",
		fontWeight: 700,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	ranChip: {
		padding: "0.12rem 0.45rem",
		borderRadius: 999,
		backgroundColor: "var(--panel-3)",
		color: "var(--muted)",
		fontSize: "0.72rem",
	},
	judgeReason: { margin: 0, color: "var(--muted)", fontSize: "0.74rem", lineHeight: 1.5 },
	judgeAskedLabel: {
		marginRight: "0.35rem",
		color: "var(--subtle)",
		fontSize: "0.61rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	judgeContextDisclosure: {
		borderTop: "1px solid var(--border)",
		paddingTop: "0.45rem",
	},
	judgeContextSummary: {
		cursor: "pointer",
		color: { default: "var(--muted)", ":hover": "var(--text)" },
		fontSize: "0.74rem",
		fontWeight: 650,
	},
	runTabs: { display: "inline-flex", alignItems: "center", gap: "0.12rem" },
	runTab: {
		padding: "0.12rem 0.3rem",
		borderRadius: 4,
		backgroundColor: { default: "transparent", ":hover": "var(--panel-3)" },
		color: "var(--subtle)",
		fontSize: "0.5rem",
		fontWeight: 750,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
		cursor: "pointer",
	},
	runTabActive: { backgroundColor: "var(--accent-soft)", color: "var(--accent)" },
	conversationTabs: {
		display: "flex",
		flexWrap: "wrap",
		gap: "0.9rem",
		padding: "0 0.15rem",
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "var(--border)",
	},
	conversationTab: {
		display: "inline-flex",
		alignItems: "center",
		gap: "0.3rem",
		boxSizing: "border-box",
		height: "1.85rem",
		minHeight: "1.85rem",
		lineHeight: 1,
		padding: "0.2rem 0.1rem",
		marginBottom: -1,
		fontSize: "0.58rem",
		fontWeight: 750,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
		borderBottomWidth: 2,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		borderRadius: 0,
		backgroundColor: "transparent",
		color: "var(--muted)",
		cursor: "pointer",
	},
	conversationTabActive: {
		borderBottomColor: "var(--accent)",
		color: "var(--text)",
	},
	conversationTabDot: {
		width: "0.28rem",
		height: "0.28rem",
		borderRadius: 999,
		flex: "none",
	},
	conversationTabDotDone: { backgroundColor: "var(--pass)" },
	conversationTabDotRunning: {
		backgroundColor: "var(--skip)",
		animationName: runningPulse,
		animationDuration: {
			default: "1.2s",
			"@media (prefers-reduced-motion: reduce)": "0.01ms",
		},
		animationIterationCount: {
			default: "infinite",
			"@media (prefers-reduced-motion: reduce)": 1,
		},
		animationTimingFunction: "ease-in-out",
	},
	conversationTabDotStopped: { backgroundColor: "var(--fail)" },
	conversationThread: { display: "grid", gap: "0.55rem" },
	runningIndicator: {
		display: "inline-flex",
		alignItems: "baseline",
		justifySelf: "start",
		gap: "0.35rem",
		padding: "0.48rem 0.65rem",
		border: "1px solid var(--border)",
		borderRadius: 999,
		backgroundColor: "var(--panel-2)",
		color: "var(--muted)",
		fontSize: "0.74rem",
		fontWeight: 650,
	},
	runningDots: { display: "inline-flex", gap: "0.15rem", color: "var(--accent)" },
	runningDot: {
		animationName: runningPulse,
		animationDuration: {
			default: "1.2s",
			"@media (prefers-reduced-motion: reduce)": "0.01ms",
		},
		animationIterationCount: {
			default: "infinite",
			"@media (prefers-reduced-motion: reduce)": 1,
		},
		animationTimingFunction: "ease-in-out",
	},
	runningDotSecond: { animationDelay: "0.16s" },
	runningDotThird: { animationDelay: "0.32s" },
	message: {
		display: "grid",
		gap: "0.28rem",
		padding: "0.65rem 0.75rem",
		borderRadius: 10,
		border: "1px solid var(--border)",
		backgroundColor: "var(--panel-2)",
		maxWidth: "78%",
	},
	messageUser: {
		justifySelf: "end",
		backgroundColor: "var(--accent-soft)",
		borderColor: "oklch(0.75 0.12 175 / 0.3)",
	},
	messageAssistant: { justifySelf: "start", backgroundColor: "var(--panel-2)" },
	messageJudge: {
		justifySelf: "start",
		backgroundColor: "var(--accent-soft)",
		borderColor: "oklch(0.75 0.12 175 / 0.3)",
	},
	messageRole: {
		color: "var(--subtle)",
		fontSize: "0.61rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	messageContent: { margin: 0, color: "var(--text)", fontSize: "0.79rem", lineHeight: 1.5 },
	judgeQuestion: {
		display: "grid",
		justifySelf: "stretch",
		gap: "0.45rem",
	},
	judgeQuestionText: {
		margin: 0,
		color: "var(--muted)",
		fontSize: "0.76rem",
		lineHeight: 1.5,
	},
	judgeContext: {
		display: "grid",
		gap: "0.4rem",
		paddingTop: "0.55rem",
		borderTop: "1px solid oklch(0.75 0.12 175 / 0.22)",
	},
	judgeContextNote: { margin: 0, color: "var(--muted)", fontSize: "0.68rem", lineHeight: 1.4 },
	judgeContextGroup: { display: "grid", gap: "0.35rem" },
	judgeContextGroupHeading: {
		margin: 0,
		color: "var(--subtle)",
		fontSize: "0.64rem",
		fontWeight: 750,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
	},
	judgeContextTabs: {
		display: "flex",
		flexWrap: "nowrap",
		gap: "0.55rem",
		overflowX: "auto",
		scrollbarWidth: "none",
		"::-webkit-scrollbar": { display: "none" },
		borderBottomWidth: 1,
		borderBottomStyle: "solid",
		borderBottomColor: "oklch(0.75 0.12 175 / 0.22)",
	},
	judgeContextTab: {
		flex: "0 0 auto",
		minHeight: "1.75rem",
		padding: "0.25rem 0.05rem",
		marginBottom: -1,
		borderBottomWidth: 2,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: { default: "transparent", ":hover": "var(--panel-3)" },
		color: "var(--muted)",
		fontSize: "0.58rem",
		fontWeight: 750,
		whiteSpace: "nowrap",
		cursor: "pointer",
	},
	judgeContextTabActive: { borderBottomColor: "var(--accent)", color: "var(--text)" },
	judgeContextAnswer: {
		display: "grid",
		gap: "0.3rem",
		padding: "0.5rem",
		borderRadius: 6,
		backgroundColor: "var(--bg)",
	},
	judgeContextList: { display: "grid", gap: "0.3rem", margin: 0 },
	judgeContextItem: {
		display: "grid",
		gridTemplateColumns: {
			default: "minmax(7.5rem, 0.3fr) minmax(0, 1fr)",
			"@media (max-width: 620px)": "1fr",
		},
		gap: "0.65rem",
		padding: "0.4rem 0.5rem",
		borderRadius: 6,
		backgroundColor: "var(--bg)",
	},
	judgeContextLabel: {
		color: "var(--subtle)",
		fontSize: "0.64rem",
		fontWeight: 750,
		letterSpacing: "0.03em",
		textTransform: "uppercase",
	},
	judgeContextValue: {
		margin: 0,
		color: "var(--text)",
		fontSize: "0.72rem",
		lineHeight: 1.45,
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
	},
	judgeResponse: {
		display: "grid",
		justifySelf: "stretch",
		gap: "0.4rem",
		padding: "0.65rem 0.7rem",
		border: "1px solid var(--border)",
		borderRadius: 10,
		backgroundColor: "var(--panel-2)",
	},
	judgeResponseHeading: {
		margin: 0,
		color: "var(--subtle)",
		fontSize: "0.61rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	judgeOutcomeList: { display: "grid", gap: "0.25rem" },
	judgeOutcome: {
		display: "grid",
		gridTemplateColumns: "0.9rem minmax(0, 1fr)",
		gap: "0.15rem 0.6rem",
	},
	judgeOutcomeLabel: { color: "var(--text)", fontSize: "0.75rem", lineHeight: 1.35 },
	judgeOutcomeExplanation: {
		gridColumn: 2,
		margin: 0,
		color: "var(--muted)",
		fontSize: "0.75rem",
		lineHeight: 1.5,
	},
	toolEvent: {
		display: "grid",
		gridTemplateColumns: "1.5rem minmax(0, 1fr) max-content",
		alignItems: "center",
		gap: "0.55rem",
		width: "min(86%, 46rem)",
		padding: "0.5rem 0.65rem",
		borderRadius: 8,
		border: "1px solid var(--border)",
		backgroundColor: "var(--panel)",
	},
	toolIcon: {
		width: "1.5rem",
		height: "1.5rem",
		display: "grid",
		placeItems: "center",
		borderRadius: 6,
		backgroundColor: "var(--panel-3)",
		color: "var(--accent)",
		fontSize: "0.7rem",
	},
	toolCopy: { display: "grid", gap: "0.08rem", minWidth: 0 },
	toolTitle: { color: "var(--text)", fontSize: "0.74rem", fontWeight: 680 },
	toolDetail: {
		color: "var(--muted)",
		fontSize: "0.69rem",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	toolOutcome: { color: "var(--pass)", fontSize: "0.64rem", fontWeight: 700 },
	toolOutcomeFail: { color: "var(--fail)" },
	toolActions: {
		display: "flex",
		alignItems: "center",
		justifyContent: "flex-end",
		gap: "0.45rem",
	},
	toolResultSummary: {
		padding: "0.14rem 0.3rem",
		borderRadius: 4,
		backgroundColor: { default: "transparent", ":hover": "var(--accent-soft)" },
		color: { default: "var(--accent)", ":hover": "var(--accent)" },
		cursor: "pointer",
		fontSize: "0.66rem",
		fontWeight: 700,
		whiteSpace: "nowrap",
	},
	toolResultPre: {
		gridColumn: "2 / -1",
		margin: 0,
		paddingTop: "0.4rem",
		borderTop: "1px solid var(--border)",
		maxHeight: "12rem",
		overflow: "auto",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		fontSize: "0.66rem",
		lineHeight: 1.45,
		color: "var(--muted)",
	},
	criteriaPanel: {
		display: "grid",
		gap: "0.55rem",
		padding: "0.75rem 0.9rem",
		borderBottom: "1px solid var(--border)",
	},
	criteriaList: { display: "grid", gap: "0.55rem", margin: 0, padding: 0, listStyle: "none" },
	criterion: { display: "flex", gap: "0.6rem", color: "var(--muted)", fontSize: "0.82rem" },
	criterionIcon: { color: "var(--subtle)", fontWeight: 800 },
	passReasonList: { display: "grid", gap: "0.35rem", margin: 0, padding: 0, listStyle: "none" },
	passReason: { display: "flex", gap: "0.5rem", color: "var(--text)", fontSize: "0.76rem" },
	passReasonIcon: { color: "var(--pass)", fontWeight: 800 },
	criterionResults: { display: "grid" },
	criterionResultList: {
		display: "grid",
		gap: "0.55rem",
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	criterionResult: {
		display: "grid",
		gap: "0.45rem",
	},
	criterionResultHeader: {
		display: "flex",
		alignItems: "flex-start",
		gap: "0.6rem",
		color: "var(--muted)",
		fontSize: "0.82rem",
	},
	criterionExplanation: {
		margin: "0 0 0 1.5rem",
		color: "var(--subtle)",
		fontSize: "0.75rem",
		lineHeight: 1.45,
	},
	criterionOutcome: {
		display: "inline-flex",
		justifyContent: "center",
		width: "0.9rem",
		flex: "0 0 0.9rem",
		fontSize: "0.8rem",
		fontWeight: 800,
		lineHeight: 1.25,
	},
	criterionOutcomePass: { color: "var(--pass)" },
	criterionOutcomeFail: { color: "var(--fail)" },
	criterionOutcomePending: { color: "var(--skip)" },
	criterionOutcomeUnknown: { color: "var(--subtle)" },
	status: {
		fontSize: "0.68rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
		padding: "0.2rem 0.55rem",
		borderRadius: 999,
		border: "1px solid var(--border)",
		color: "var(--muted)",
	},
	statusPass: {
		color: "var(--pass)",
		borderColor: "var(--pass)",
		backgroundColor: "var(--pass-soft)",
	},
	statusFail: {
		color: "var(--fail)",
		borderColor: "var(--fail)",
		backgroundColor: "var(--fail-soft)",
	},
	statusRunning: {
		color: "var(--skip)",
		borderColor: "var(--skip)",
		backgroundColor: "var(--skip-soft)",
	},
	error: {
		margin: 0,
		padding: "0.85rem 1rem",
		border: "1px solid oklch(0.73 0.18 25 / 0.36)",
		borderRadius: 9,
		backgroundColor: "var(--fail-soft)",
		color: "oklch(0.88 0.08 25)",
	},
	evidence: { borderTop: "1px solid var(--border)", paddingTop: "0.7rem" },
	evidenceSummary: {
		display: "flex",
		alignItems: "center",
		gap: "0.5rem",
		cursor: "pointer",
		color: "var(--muted)",
		fontSize: "0.82rem",
		fontWeight: 650,
		padding: "0.2rem 0",
	},
	pre: {
		margin: "0.7rem 0 0",
		overflow: "auto",
		whiteSpace: "pre-wrap",
		wordBreak: "break-word",
		fontSize: "0.76rem",
		lineHeight: 1.55,
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		color: "oklch(0.86 0.02 255)",
		backgroundColor: "var(--bg)",
		border: "1px solid var(--border)",
		borderRadius: 9,
		padding: "0.85rem",
	},
	empty: { color: "var(--muted)", fontStyle: "italic", padding: "1rem 0" },
});

function ViewerLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [workers, setWorkers] = useState(1);
	const narrow = useNarrowViewer();
	const menuButton = useRef<HTMLButtonElement>(null);
	const closeDrawer = useCallback(() => setDrawerOpen(false), []);
	useEffect(() => {
		if (!narrow) setDrawerOpen(false);
	}, [narrow]);
	return (
		<WorkerContext.Provider value={{ workers, setWorkers }}>
			<div
				{...stylex.props(
					styles.shell,
					narrow && styles.shellNarrow,
					!narrow && !sidebarOpen && styles.shellCollapsed,
				)}
			>
				<a href="#viewer-main" {...stylex.props(styles.skipLink)}>
					Skip to content
				</a>
				{narrow ? (
					<>
						<MobileViewerHeader
							buttonRef={menuButton}
							open={drawerOpen}
							onOpen={() => setDrawerOpen(true)}
						/>
						<MobileTestDrawer open={drawerOpen} onClose={closeDrawer} />
					</>
				) : (
					<ViewerSidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
				)}
				<main id="viewer-main" tabIndex={-1} {...stylex.props(styles.main)}>
					<Outlet />
				</main>
			</div>
		</WorkerContext.Provider>
	);
}

function useNarrowViewer(): boolean {
	const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_VIEWER_QUERY).matches);
	useEffect(() => {
		const query = window.matchMedia(NARROW_VIEWER_QUERY);
		const update = () => setNarrow(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return narrow;
}

function MobileViewerHeader({
	buttonRef,
	open,
	onOpen,
}: {
	buttonRef: RefObject<HTMLButtonElement | null>;
	open: boolean;
	onOpen: () => void;
}) {
	const catalog = useCatalog();
	return (
		<header {...stylex.props(styles.mobileHeader)}>
			<button
				ref={buttonRef}
				type="button"
				aria-haspopup="dialog"
				aria-controls="mobile-test-drawer"
				aria-expanded={open}
				aria-label="Open test menu"
				{...stylex.props(styles.buttonReset, styles.mobileMenuButton)}
				onClick={onOpen}
			>
				<span aria-hidden="true">☰</span>
			</button>
			<div {...stylex.props(styles.mobileHeaderIdentity)}>
				<span {...stylex.props(styles.mobileHeaderTitle)}>Tests</span>
				<span {...stylex.props(styles.countBadge)}>{catalog.data?.tests.length ?? 0}</span>
			</div>
		</header>
	);
}

function MobileTestDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		const closeOnBackdrop = (event: MouseEvent) => {
			if (event.target === element) onClose();
		};
		element.addEventListener("click", closeOnBackdrop);
		let focusFrame: number | undefined;
		if (open && !element.open) {
			element.showModal();
			focusFrame = requestAnimationFrame(() => {
				element.querySelector<HTMLButtonElement>("[data-drawer-close]")?.focus();
			});
		}
		if (!open && element.open) element.close();
		return () => {
			element.removeEventListener("click", closeOnBackdrop);
			if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
		};
	}, [onClose, open]);
	return (
		<dialog
			ref={dialog}
			id="mobile-test-drawer"
			data-mobile-drawer="true"
			aria-labelledby="mobile-tests-title"
			{...stylex.props(styles.mobileDrawerDialog)}
			onCancel={onClose}
			onClose={onClose}
		>
			<div {...stylex.props(styles.mobileDrawerSurface)}>
				<ViewerSidebarContent
					mode="mobile"
					headingId="mobile-tests-title"
					navigationId="mobile-test-navigation"
					onClose={onClose}
				/>
			</div>
		</dialog>
	);
}

function ViewerSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<aside {...stylex.props(styles.sidebar, !open && styles.sidebarCollapsed)}>
			<ViewerSidebarContent
				mode="desktop"
				open={open}
				navigationId="test-navigation"
				onToggle={onToggle}
			/>
		</aside>
	);
}

function ViewerSidebarContent({
	mode,
	open = true,
	headingId,
	navigationId,
	onToggle,
	onClose,
}: {
	mode: "desktop" | "mobile";
	open?: boolean;
	headingId?: string;
	navigationId: string;
	onToggle?: () => void;
	onClose?: () => void;
}) {
	const catalog = useCatalog();
	const history = useExecutionHistory();
	const groups = groupTests(catalog.data?.tests ?? []);
	const statuses = latestTestStatuses(history.data ?? []);
	return (
		<>
			<SidebarHeader
				mode={mode}
				open={open}
				count={catalog.data?.tests.length ?? 0}
				headingId={headingId}
				navigationId={navigationId}
				onToggle={mode === "mobile" ? onClose : onToggle}
				onNavigate={onClose}
			/>
			{open ? (
				<SidebarNavigation
					groups={groups}
					statuses={statuses}
					error={catalog.isError}
					navigationId={navigationId}
					onNavigate={onClose}
				/>
			) : null}
		</>
	);
}

function SidebarHeader({
	mode,
	open,
	count,
	headingId,
	navigationId,
	onToggle,
	onNavigate,
}: {
	mode: "desktop" | "mobile";
	open: boolean;
	count: number;
	headingId?: string;
	navigationId: string;
	onToggle?: () => void;
	onNavigate?: () => void;
}) {
	const { workers } = useContext(WorkerContext);
	const navigate = useNavigate();
	const client = useQueryClient();
	const run = useMutation({
		mutationFn: () => startSuite(workers),
		onSuccess: ({ executionId }) => {
			void client.invalidateQueries({ queryKey: ["execution-history"] });
			void navigate({ to: "/executions/$executionId", params: { executionId } });
			onNavigate?.();
		},
	});
	return (
		<header {...stylex.props(styles.sidebarHeader, !open && styles.sidebarHeaderCollapsed)}>
			{open ? (
				<>
					<div {...stylex.props(styles.sidebarTitleRow)}>
						<div {...stylex.props(styles.sidebarTitleIdentity)}>
							<h1 id={headingId} {...stylex.props(styles.title, styles.sidebarTitle)}>
								Tests
							</h1>
							<span {...stylex.props(styles.countBadge)}>{count}</span>
						</div>
						<SidebarToggle
							mode={mode}
							open={open}
							navigationId={navigationId}
							onToggle={onToggle}
						/>
					</div>
					<Link
						to="/"
						activeOptions={{ exact: true }}
						{...stylex.props(styles.navLink, styles.runsLink)}
						activeProps={stylex.props(styles.navLink, styles.runsLink, styles.active)}
						onClick={onNavigate}
					>
						<span aria-hidden="true">◷</span> Runs
					</Link>
					<div {...stylex.props(styles.suiteControls)}>
						<button
							type="button"
							{...stylex.props(styles.buttonReset, styles.suiteRunButton)}
							onClick={() => run.mutate()}
							disabled={run.isPending || count === 0}
						>
							<span aria-hidden="true">{run.isPending ? "●" : "▶"}</span>
							{run.isPending ? "Starting suite…" : "Run all tests"}
						</button>
						<WorkerControl />
					</div>
					{run.isError ? <p role="alert">{run.error.message}</p> : null}
				</>
			) : (
				<SidebarToggle mode={mode} open={open} navigationId={navigationId} onToggle={onToggle} />
			)}
		</header>
	);
}
function WorkerControl() {
	const { workers, setWorkers } = useContext(WorkerContext);
	return (
		<label {...stylex.props(styles.workerControl)}>
			<span>Workers</span>
			<input
				type="number"
				aria-label="Concurrent workers"
				min={1}
				max={32}
				value={workers}
				{...stylex.props(styles.workerInput)}
				onChange={(event) => {
					const next = Number(event.currentTarget.value);
					if (Number.isInteger(next)) setWorkers(Math.min(32, Math.max(1, next)));
				}}
			/>
		</label>
	);
}

function SidebarToggle({
	mode,
	open,
	navigationId,
	onToggle,
}: {
	mode: "desktop" | "mobile";
	open: boolean;
	navigationId: string;
	onToggle?: () => void;
}) {
	const mobile = mode === "mobile";
	return (
		<button
			type="button"
			data-drawer-close={mobile ? "true" : undefined}
			aria-controls={navigationId}
			aria-expanded={open}
			aria-label={
				mobile ? "Close test menu" : open ? "Collapse test sidebar" : "Expand test sidebar"
			}
			{...stylex.props(styles.buttonReset, styles.toggleButton, mobile && styles.mobileCloseButton)}
			onClick={onToggle}
		>
			{mobile ? "×" : open ? "←" : "→"}
		</button>
	);
}

function SidebarNavigation({
	groups,
	statuses,
	error,
	navigationId,
	onNavigate,
}: {
	groups: Map<string, TestRecord[]>;
	statuses: Map<string, TestStatusValue>;
	error: boolean;
	navigationId: string;
	onNavigate?: () => void;
}) {
	return (
		<>
			{error ? <p role="alert">Test discovery is unavailable.</p> : null}
			<nav id={navigationId} aria-label="Tests" {...stylex.props(styles.navigation)}>
				{[...groups].map(([name, tests]) => (
					<section key={name} aria-label={`${name} tests`} {...stylex.props(styles.navSection)}>
						<div {...stylex.props(styles.groupHeader)}>
							<strong {...stylex.props(styles.groupLabel)}>{name}</strong>
							<div {...stylex.props(styles.groupHeaderActions)}>
								<span {...stylex.props(styles.groupCount)}>{tests.length}</span>
								<RunTestGroupButton name={name} tests={tests} onNavigate={onNavigate} />
							</div>
						</div>
						{tests.map((test) => (
							<TestLink
								key={test.id}
								test={test}
								status={statuses.get(test.id)}
								onNavigate={onNavigate}
							/>
						))}
					</section>
				))}
			</nav>
		</>
	);
}
function RunTestGroupButton({
	name,
	tests,
	onNavigate,
}: {
	name: string;
	tests: TestRecord[];
	onNavigate?: () => void;
}) {
	const { workers } = useContext(WorkerContext);
	const navigate = useNavigate();
	const client = useQueryClient();
	const run = useMutation({
		mutationFn: () =>
			startTestGroup(
				tests.map((test) => test.id),
				workers,
			),
		onSuccess: ({ executionId }) => {
			void client.invalidateQueries({ queryKey: ["execution-history"] });
			void navigate({ to: "/executions/$executionId", params: { executionId } });
			onNavigate?.();
		},
	});
	return (
		<button
			type="button"
			aria-label={`Run ${name} suite`}
			title={`Run ${name} suite`}
			{...stylex.props(styles.buttonReset, styles.groupRunButton)}
			onClick={() => run.mutate()}
			disabled={run.isPending}
		>
			{run.isPending ? "●" : "▶"}
		</button>
	);
}
function TestLink({
	test,
	status,
	onNavigate,
}: {
	test: TestRecord;
	status?: TestStatusValue;
	onNavigate?: () => void;
}) {
	return (
		<Link
			to="/tests/$testId"
			params={{ testId: test.id }}
			search={{}}
			{...stylex.props(styles.navLink)}
			activeProps={stylex.props(styles.navLink, styles.active)}
			onClick={onNavigate}
		>
			<div {...stylex.props(styles.navItemHeader)}>
				{status ? <TestStatus status={status} /> : <span aria-hidden="true" />}
				<span {...stylex.props(styles.navItemTitle)}>{test.title.at(-1)}</span>
			</div>
			{test.project !== "default" ? <div {...stylex.props(styles.meta)}>{test.project}</div> : null}
		</Link>
	);
}

function TestStatus({ status }: { status: TestStatusValue }) {
	return (
		<span
			role="img"
			aria-label={`Latest execution: ${status}`}
			title={`Latest execution: ${status}`}
			{...stylex.props(styles.navStatus)}
		>
			<span
				aria-hidden="true"
				{...stylex.props(
					styles.navStatusDot,
					status === "passed" && styles.navStatusDotPass,
					status === "failed" && styles.navStatusDotFail,
					status === "running" && styles.navStatusDotRunning,
				)}
			/>
		</span>
	);
}
function TestPage() {
	const { testId } = testRoute.useParams();
	const catalog = useCatalog();
	if (catalog.isPending) return <p>Loading test…</p>;
	const test = catalog.data?.tests.find((item) => item.id === testId);
	if (!test)
		return (
			<p role="alert">This test is no longer available. Choose another test in the sidebar.</p>
		);
	return <TestDetail key={test.id} test={test} />;
}
function TestDetail({ test }: { test: TestRecord }) {
	const { execution, view } = testRoute.useSearch();
	const history = useExecutionHistory();
	const navigate = useNavigate();
	const runs = history.data?.filter((item) => item.testIds?.includes(test.id)) ?? [];
	const selected = execution ?? preferredTestExecutionId(runs, test.id);
	const activeView = view ?? "current";
	const chooseExecution = (id: string) =>
		void navigate({
			to: "/tests/$testId",
			params: { testId: test.id },
			search: { execution: id },
		});
	const chooseView = (next: TestView) =>
		void navigate({
			to: "/tests/$testId",
			params: { testId: test.id },
			search: { execution, view: next === "current" ? undefined : next },
		});
	return (
		<>
			<TestHeader test={test} onStarted={chooseExecution} />
			<BatchRunLink run={runs.find((run) => run.id === selected)} />
			<TestTabs active={activeView} onChange={chooseView} />
			<TestViewPanel
				view={activeView}
				test={test}
				runs={runs}
				selected={selected}
				historyLoading={history.isPending}
				onChooseExecution={chooseExecution}
			/>
		</>
	);
}

/** Return path to the run inbox when this test was opened from a batch run. */
function BatchRunLink({ run }: { run?: ExecutionSummary }) {
	const count = run?.testIds?.length ?? 0;
	if (!run || count < 2) return null;
	return (
		<Link
			to="/executions/$executionId"
			params={{ executionId: run.id }}
			{...stylex.props(styles.batchRunLink)}
		>
			← Back to run · {formatRunDate(run.startedAt)} · {count} tests
		</Link>
	);
}

function TestHeader({ test, onStarted }: { test: TestRecord; onStarted: (id: string) => void }) {
	return (
		<header {...stylex.props(styles.hero)}>
			<div {...stylex.props(styles.heroTop)}>
				<div {...stylex.props(styles.heroCopy)}>
					<div {...stylex.props(styles.brand)}>{test.title.slice(0, -1).join(" / ")}</div>
					<h2 {...stylex.props(styles.title)}>{test.title.at(-1)}</h2>
					<p {...stylex.props(styles.description)}>
						{test.description ?? "This test has no additional description."}
					</p>
				</div>
				<RunTestButton test={test} onStarted={onStarted} />
			</div>
			<div {...stylex.props(styles.path)}>
				{test.project} · {test.file}
			</div>
		</header>
	);
}

const TEST_VIEWS: Array<{ id: TestView; label: string }> = [
	{ id: "current", label: "Current run" },
	{ id: "setup", label: "Test setup" },
	{ id: "history", label: "Run history" },
];

function TestTabs({ active, onChange }: { active: TestView; onChange: (view: TestView) => void }) {
	return (
		<div role="tablist" aria-label="Test views" {...stylex.props(styles.tabList)}>
			{TEST_VIEWS.map((view) => (
				<button
					key={view.id}
					id={`test-tab-${view.id}`}
					type="button"
					role="tab"
					aria-controls={`test-panel-${view.id}`}
					aria-selected={active === view.id}
					tabIndex={active === view.id ? 0 : -1}
					{...stylex.props(styles.buttonReset, styles.tab, active === view.id && styles.tabActive)}
					onClick={() => onChange(view.id)}
					onKeyDown={(event) => handleTabKeyDown(event, view.id, onChange)}
				>
					{view.label}
				</button>
			))}
		</div>
	);
}

function handleTabKeyDown(
	event: KeyboardEvent<HTMLButtonElement>,
	active: TestView,
	onChange: (view: TestView) => void,
) {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	event.preventDefault();
	const index = TEST_VIEWS.findIndex((view) => view.id === active);
	const nextIndex =
		event.key === "Home"
			? 0
			: event.key === "End"
				? TEST_VIEWS.length - 1
				: (index + (event.key === "ArrowRight" ? 1 : -1) + TEST_VIEWS.length) % TEST_VIEWS.length;
	const next = TEST_VIEWS[nextIndex];
	if (!next) return;
	onChange(next.id);
	document.getElementById(`test-tab-${next.id}`)?.focus();
}

type TestViewPanelProps = {
	view: TestView;
	test: TestRecord;
	runs: ExecutionSummary[];
	selected?: string;
	historyLoading: boolean;
	onChooseExecution: (id: string) => void;
};
function TestViewPanel(props: TestViewPanelProps) {
	return (
		<div
			id={`test-panel-${props.view}`}
			role="tabpanel"
			aria-labelledby={`test-tab-${props.view}`}
			{...stylex.props(styles.tabPanel)}
		>
			{props.view === "setup" ? <TestResources test={props.test} /> : null}
			{props.view === "current" ? (
				<CurrentRun test={props.test} executionId={props.selected} loading={props.historyLoading} />
			) : null}
			{props.view === "history" ? (
				<RunHistory runs={props.runs} testId={props.test.id} onChoose={props.onChooseExecution} />
			) : null}
		</div>
	);
}

function CurrentRun({
	test,
	executionId,
	loading,
}: {
	test: TestRecord;
	executionId?: string;
	loading: boolean;
}) {
	return (
		<section {...stylex.props(styles.tabSection)}>
			{loading && !executionId ? (
				<p {...stylex.props(styles.empty)}>Loading runs…</p>
			) : executionId ? (
				<TestExecution id={executionId} test={test} />
			) : (
				<p {...stylex.props(styles.empty)}>
					No runs yet. Start this test to see its progress here.
				</p>
			)}
		</section>
	);
}

function RunHistory({
	runs,
	testId,
	onChoose,
}: {
	runs: ExecutionSummary[];
	testId: string;
	onChoose: (id: string) => void;
}) {
	return (
		<section {...stylex.props(styles.tabSection)}>
			<div {...stylex.props(styles.quietHeader)}>
				<span {...stylex.props(styles.sectionIntro)}>
					{runs.length} {pluralize(runs.length, "run")} included this test. Each shows this test's
					own result.
				</span>
			</div>
			{runs.length ? (
				<div {...stylex.props(styles.historyList)}>
					{runs.map((run) => (
						<HistoryItem key={run.id} run={run} testId={testId} onChoose={onChoose} />
					))}
				</div>
			) : (
				<p {...stylex.props(styles.empty)}>No saved runs for this test.</p>
			)}
		</section>
	);
}

function HistoryItem({
	run,
	testId,
	onChoose,
}: {
	run: ExecutionSummary;
	testId: string;
	onChoose: (id: string) => void;
}) {
	const status = testRunStatus(run, testId);
	const others = (run.testIds?.length ?? 1) - 1;
	return (
		<button
			type="button"
			aria-label={`Open ${status} execution ${run.id.slice(0, 8)}`}
			{...stylex.props(styles.buttonReset, styles.historyButton)}
			onClick={() => onChoose(run.id)}
		>
			<span {...stylex.props(styles.historyIdentity)}>
				<span {...stylex.props(styles.historyDate)}>{formatRunDate(run.startedAt)}</span>
				<span {...stylex.props(styles.historyId)}>
					{run.id.slice(0, 8)}
					{others > 0 ? ` · with ${others} other ${pluralize(others, "test")}` : ""}
				</span>
			</span>
			<StatusPill status={status} />
		</button>
	);
}

function StatusPill({ status }: { status: TestStatusValue | ExecutionSummary["status"] }) {
	return (
		<span
			{...stylex.props(
				styles.status,
				status === "passed" && styles.statusPass,
				status === "failed" && styles.statusFail,
				(status === "running" || status === "queued") && styles.statusRunning,
			)}
		>
			{status}
		</span>
	);
}
function RunTestButton({ test, onStarted }: { test: TestRecord; onStarted: (id: string) => void }) {
	const { workers } = useContext(WorkerContext);
	const client = useQueryClient();
	const run = useMutation({
		mutationFn: () => startTest(test.id, workers),
		onSuccess: ({ executionId }) => {
			onStarted(executionId);
			void client.invalidateQueries({ queryKey: ["execution-history"] });
		},
	});
	return (
		<div {...stylex.props(styles.heroAction)}>
			<button
				type="button"
				{...stylex.props(styles.buttonReset, styles.button)}
				onClick={() => run.mutate()}
				disabled={run.isPending}
			>
				<span aria-hidden="true" {...stylex.props(styles.buttonIcon)}>
					{run.isPending ? "●" : "▶"}
				</span>
				{run.isPending ? "Starting…" : "Run this test"}
			</button>
			{run.isError ? <p role="alert">{run.error.message}</p> : null}
		</div>
	);
}
function TestResources({ test }: { test: TestRecord }) {
	const resources = test.resources ?? [];
	const agents = resources.filter((resource) => resource.kind === "agent");
	const judges = resources.filter((resource) => resource.kind === "judge");
	return (
		<section aria-label="Test setup details" {...stylex.props(styles.contextPanel)}>
			<CriteriaSetup test={test} />
			<div {...stylex.props(styles.setupBody)}>
				<ResourceSection
					title="Agents"
					description="Task agents this test can start."
					resources={agents}
				/>
				<ResourceSection
					title="Judges"
					description="Reviewers that evaluate agent output."
					resources={judges}
				/>
				<WorkspaceSetup test={test} />
			</div>
		</section>
	);
}

function CriteriaSetup({ test }: { test: TestRecord }) {
	const criteria = testCriteria(test);
	return (
		<section aria-labelledby="setup-criteria" {...stylex.props(styles.criteriaPanel)}>
			<h3 id="setup-criteria" {...stylex.props(styles.contentHeading)}>
				Pass criteria
			</h3>
			<p {...stylex.props(styles.sectionIntro)}>
				Every one of these must hold for the test to pass.
			</p>
			{criteria.length ? (
				<ul {...stylex.props(styles.criteriaList)}>
					{criteria.map((criterion) => (
						<li key={criterion} {...stylex.props(styles.criterion)}>
							<span aria-hidden="true" {...stylex.props(styles.criterionIcon)}>
								•
							</span>
							<span>{criterion}</span>
						</li>
					))}
				</ul>
			) : (
				<p {...stylex.props(styles.meta)}>No explicit pass criteria are declared.</p>
			)}
		</section>
	);
}

function ResourceSection({
	title,
	description,
	resources,
}: {
	title: "Agents" | "Judges";
	description: string;
	resources: NonNullable<TestRecord["resources"]>;
}) {
	const id = `setup-${title.toLowerCase()}`;
	const noun = title === "Agents" ? "agent" : "judge";
	return (
		<section aria-labelledby={id} {...stylex.props(styles.setupSection)}>
			<header {...stylex.props(styles.setupSectionHeader)}>
				<div {...stylex.props(styles.setupSectionCopy)}>
					<h3 id={id} {...stylex.props(styles.contentHeading)}>
						{title}
					</h3>
					<p {...stylex.props(styles.meta)}>{description}</p>
				</div>
				<span {...stylex.props(styles.resourceCount)}>
					{resources.length} {pluralize(resources.length, noun)}
				</span>
			</header>
			{resources.length ? (
				<div {...stylex.props(styles.resourceGrid)}>
					{resources.map((resource) => (
						<ResourceCard key={resource.name} resource={resource} />
					))}
				</div>
			) : (
				<p {...stylex.props(styles.meta)}>None declared.</p>
			)}
		</section>
	);
}

function ResourceCard({ resource }: { resource: NonNullable<TestRecord["resources"]>[number] }) {
	return (
		<article {...stylex.props(styles.card, styles.resourceCard)}>
			<div {...stylex.props(styles.resourceHeader)}>
				<strong>{resource.name}</strong>
			</div>
			<ResourceContext resource={resource} />
		</article>
	);
}

function WorkspaceSetup({ test }: { test: TestRecord }) {
	return (
		<section aria-labelledby="setup-workspace" {...stylex.props(styles.setupSection)}>
			<div {...stylex.props(styles.setupSectionCopy)}>
				<h3 id="setup-workspace" {...stylex.props(styles.contentHeading)}>
					Workspace
				</h3>
				<p {...stylex.props(styles.meta)}>
					Each agent run starts from a fresh copy of this folder.
				</p>
			</div>
			<div {...stylex.props(styles.workspaceRow)}>
				<ResourceFact label="Source folder" value={test.workspace ?? "Project directory"} />
			</div>
		</section>
	);
}

function testCriteria(test: TestRecord): string[] {
	if (test.criteria?.length) return test.criteria;
	return test.description ? [test.description] : [];
}

function ResourceContext({ resource }: { resource: NonNullable<TestRecord["resources"]>[number] }) {
	return (
		<div {...stylex.props(styles.resourceBody)}>
			{resource.description ? (
				<p {...stylex.props(styles.resourceDescription)}>{resource.description}</p>
			) : null}
			<div {...stylex.props(styles.resourceFacts)}>
				<ResourceFact label="Host" value={resource.host ?? "Not configured"} />
				<ResourceFact label="Model" value={resource.model ?? "Host default"} />
				{resource.workspace ? <ResourceFact label="Workspace" value={resource.workspace} /> : null}
				{resource.skills.length ? (
					<ResourceFact label="Skills" value={resource.skills.join(", ")} />
				) : null}
				{resource.mcpServers.length ? (
					<ResourceFact label="MCP" value={resource.mcpServers.join(", ")} />
				) : null}
			</div>
			{resource.prompt ? (
				<div {...stylex.props(styles.resourcePrompt)}>
					<span {...stylex.props(styles.resourceFactLabel)}>Prompt</span>
					<p {...stylex.props(styles.resourceFactValue)}>{resource.prompt}</p>
				</div>
			) : null}
		</div>
	);
}

function ResourceFact({ label, value }: { label: string; value: string }) {
	return (
		<div {...stylex.props(styles.resourceFact)}>
			<span {...stylex.props(styles.resourceFactLabel)}>{label}</span>
			<span {...stylex.props(styles.resourceFactValue)}>{value}</span>
		</div>
	);
}
function TestExecution({ id, test }: { id: string; test: TestRecord }) {
	const detail = useQuery({
		queryKey: ["execution", id],
		queryFn: () => fetchExecution(id),
	});
	if (detail.isPending) return <p>Loading execution…</p>;
	if (!detail.data) return <p role="alert">Execution is unavailable.</p>;
	const attempts = detail.data.attempts.filter((attempt) => attempt.testId === test.id);
	if (detail.data.testIds && !detail.data.testIds.includes(test.id))
		return <p>This execution does not contain this test.</p>;
	if (attempts.length === 0 && testRunStatus(detail.data, test.id) === "skipped")
		return (
			<p {...stylex.props(styles.empty)}>
				This test was skipped in this run. Open Run history to find a run that executed it.
			</p>
		);
	return (
		<ExecutionDetailView execution={{ ...detail.data, attempts }} criteria={testCriteria(test)} />
	);
}

function ExecutionRunPage() {
	const { executionId } = executionRoute.useParams();
	return <RunPage key={executionId} executionId={executionId} />;
}

function ExecutionDetailView({
	execution,
	criteria = [],
}: {
	execution: ExecutionDetail;
	criteria?: string[];
}) {
	const client = useQueryClient();
	const cancel = useMutation({
		mutationFn: () => cancelExecution(execution.id),
		onSuccess: () => client.invalidateQueries({ queryKey: ["execution", execution.id] }),
	});
	const stopping = execution.status === "running" && (cancel.isPending || cancel.isSuccess);
	const stopLabel = (execution.testIds?.length ?? 0) > 1 ? "Stop suite run" : "Stop this run";
	return (
		<div {...stylex.props(styles.statusPanel)}>
			{execution.status === "running" && execution.cancellable ? (
				<div {...stylex.props(styles.runControls)}>
					<button
						type="button"
						{...stylex.props(styles.buttonReset, styles.button, styles.secondaryButton)}
						onClick={() => cancel.mutate()}
						disabled={stopping}
					>
						{stopping ? "Stopping…" : stopLabel}
					</button>
				</div>
			) : null}
			{cancel.isError ? <p role="alert">The run could not be stopped.</p> : null}
			<section {...stylex.props(styles.list)}>
				{execution.attempts.map((attempt) => (
					<AttemptCard key={attempt.id} attempt={attempt} criteria={criteria} showTitle={false} />
				))}
				{execution.attempts.length === 0 ? (
					<p {...stylex.props(styles.empty)}>{emptyExecutionMessage(execution, stopping)}</p>
				) : null}
			</section>
		</div>
	);
}

function emptyExecutionMessage(execution: ExecutionDetail, stopping: boolean): string {
	if (stopping) return "Stopping this run…";
	if (execution.status === "interrupted") return "Run stopped before the first test started.";
	if (execution.status === "failed") return "Run failed before the first test started.";
	if (execution.status === "passed") return "Run completed without starting a test.";
	const count = execution.testIds?.length ?? 0;
	return count ? `Starting ${count} ${pluralize(count, "test")}…` : "Starting the test run…";
}

function ComparePage() {
	const { left, right } = compareRoute.useParams();
	const [first, second] = useQueries({
		queries: [left, right].map((id) => ({
			queryKey: ["execution", id],
			queryFn: () => fetchExecution(id),
		})),
	});
	if (first.isLoading || second.isLoading)
		return <p {...stylex.props(styles.empty)}>Loading saved runs…</p>;
	if (!first.data || !second.data)
		return <p {...stylex.props(styles.empty)}>A selected execution is unavailable.</p>;
	return (
		<>
			<div {...stylex.props(styles.brand)}>Saved run comparison</div>
			<h2 {...stylex.props(styles.title)}>Two execution records</h2>
			<section {...stylex.props(styles.section)}>
				<ComparisonColumn label="First" execution={first.data} />
				<ComparisonColumn label="Second" execution={second.data} />
			</section>
		</>
	);
}

function ComparisonColumn({ execution, label }: { execution: ExecutionDetail; label: string }) {
	return (
		<article {...stylex.props(styles.card)}>
			<strong>
				{label}: {execution.status}
			</strong>
			<p {...stylex.props(styles.meta)}>{execution.id.slice(0, 8)}</p>
			{execution.attempts.map((attempt) => (
				<AttemptCard key={attempt.id} attempt={attempt} />
			))}
		</article>
	);
}

/** `showTitle` is off on a test page, whose header already names the test. */
function AttemptCard({
	attempt,
	criteria = [],
	showTitle = true,
}: {
	attempt: Attempt;
	criteria?: string[];
	showTitle?: boolean;
}) {
	const { operations, output, title } = attemptPresentation(attempt, criteria);
	const agents = operations.filter((operation) => operation.kind !== "evaluation");
	const judges = operations.filter((operation) => operation.kind === "evaluation");
	return (
		<article {...stylex.props(styles.attemptCard)}>
			<div {...stylex.props(styles.row)}>
				<div>
					{showTitle ? <strong {...stylex.props(styles.attemptTitle)}>{title}</strong> : null}
					<p {...stylex.props(styles.meta)}>
						{attempt.project || "default"} · {attempt.operations.length} named{" "}
						{pluralize(attempt.operations.length, "operation")}
					</p>
				</div>
				<div {...stylex.props(styles.attemptActions)}>
					{attempt.status === "failed" ? (
						<CopyFailureButton attempt={attempt} criteria={criteria} />
					) : null}
					<span
						{...stylex.props(
							styles.status,
							attempt.status === "passed" && styles.statusPass,
							attempt.status === "failed" && styles.statusFail,
							attempt.status === "running" && styles.statusRunning,
						)}
					>
						{attempt.status}
					</span>
				</div>
			</div>
			<TestVerdict attempt={attempt} criteria={criteria} operations={operations} />
			<OperationList operations={operations} />
			<ConversationSection
				label="Judges"
				sectionOperations={judges}
				allOperations={operations}
				attempt={attempt}
			/>
			<ConversationSection
				label="Agents"
				sectionOperations={agents}
				allOperations={operations}
				attempt={attempt}
			/>
			<TechnicalDetails operations={operations} output={output} />
		</article>
	);
}

/** Test-level outcome first: every check with its result, including judge-decided checks. */
function TestVerdict({
	attempt,
	criteria,
	operations,
}: {
	attempt: Attempt;
	criteria: string[];
	operations: Attempt["operations"];
}) {
	const presentations = criterionPresentations({
		criteria,
		explanations: judgeCriterionExplanations(criteria, operations),
		results: attempt.criterionResults,
		status: attempt.status,
		errors: attempt.errors,
	});
	return (
		<section
			aria-label="Test verdict"
			{...stylex.props(
				styles.verdictPanel,
				attempt.status === "passed" && styles.verdictPass,
				attempt.status === "failed" && styles.verdictFail,
			)}
		>
			<p {...stylex.props(styles.verdictHeadline)}>
				{capitalize(attempt.status)}
				<span {...stylex.props(styles.verdictCount)}>
					{checkSummary(presentations, attempt.status)}
				</span>
			</p>
			{attempt.status === "running" ? (
				<p {...stylex.props(styles.meta)}>The test is still running.</p>
			) : null}
			<VerdictMetrics operations={operations} />
			<VerdictChecks presentations={presentations} />
			<UnassignedFailures errors={attempt.errors} presentations={presentations} />
		</section>
	);
}

const SHORT_CHECK_LIST = 3;

/** Checks needing attention always show; passing checks fold away once the list is long. */
function VerdictChecks({ presentations }: { presentations: CriterionPresentation[] }) {
	const checks = presentations;
	if (checks.length <= SHORT_CHECK_LIST) return <CriterionResults presentations={checks} />;
	const attention = checks.filter((check) => check.outcome !== "passed");
	const passed = checks.filter((check) => check.outcome === "passed");
	return (
		<>
			<CriterionResults presentations={attention} />
			{passed.length ? (
				<details data-disclosure {...stylex.props(styles.verdictPassedChecks)}>
					<summary {...stylex.props(styles.judgeContextSummary)}>
						{passed.length} passed {pluralize(passed.length, "check")}
					</summary>
					<CriterionResults presentations={passed} label="Passed checks" />
				</details>
			) : null}
		</>
	);
}

/** Failures no check claimed, such as a crash before the first assertion. */
function UnassignedFailures({
	errors,
	presentations,
}: {
	errors: Attempt["errors"];
	presentations: CriterionPresentation[];
}) {
	const assigned = new Set(presentations.map((item) => item.failure).filter(Boolean));
	return errors
		.filter((error) => !assigned.has(error.message))
		.map((error, index) => <FailureDetails key={index} message={error.message ?? "Test failed"} />);
}

type MetricKey = "durationMs" | "totalTokens" | "toolCallCount" | "changedPathCount";
const VERDICT_METRICS: Array<{ key: MetricKey; label: string; format: (value: number) => string }> =
	[
		{ key: "durationMs", label: "Duration", format: formatDuration },
		{ key: "totalTokens", label: "Tokens", format: (value) => Math.round(value).toLocaleString() },
		{ key: "toolCallCount", label: "Tool calls", format: (value) => String(Math.round(value)) },
		{
			key: "changedPathCount",
			label: "Files changed",
			format: (value) => String(Math.round(value)),
		},
	];

/** Agent totals for the attempt; a median per run when the test made several agent runs. */
function VerdictMetrics({ operations }: { operations: Attempt["operations"] }) {
	const runs = operations
		.filter((operation) => operation.kind !== "evaluation")
		.map((operation) => operationResult([operation]));
	const rows = VERDICT_METRICS.flatMap((metric) => {
		const values = runs.flatMap((run) =>
			run[metric.key] === undefined ? [] : [run[metric.key] ?? 0],
		);
		if (!values.length) return [];
		const total = values.reduce((sum, value) => sum + value, 0);
		return [{ ...metric, total, median: median(values) ?? total }];
	});
	if (!rows.length) return null;
	const repeated = runs.length > 1;
	return (
		<dl aria-label="Run metrics" {...stylex.props(styles.verdictMetrics)}>
			{rows.map((row) => (
				<div key={row.key} {...stylex.props(styles.verdictMetric)}>
					<dt {...stylex.props(styles.resourceFactLabel)}>{row.label}</dt>
					<dd {...stylex.props(styles.verdictMetricValue)}>
						{row.format(row.total)}
						{repeated ? (
							<span {...stylex.props(styles.verdictMetricMedian)}>
								median {row.format(row.median)} per run
							</span>
						) : null}
					</dd>
				</div>
			))}
		</dl>
	);
}

function checkSummary(presentations: CriterionPresentation[], status: string): string {
	const total = presentations.length;
	if (!total) return "";
	const failed = presentations.filter((item) => item.outcome === "failed").length;
	const passed = presentations.filter((item) => item.outcome === "passed").length;
	const checks = pluralize(total, "check");
	if (failed) return ` · ${failed} of ${total} ${checks} failed`;
	return ` · ${passed} of ${total} ${checks} passed${status === "running" ? " so far" : ""}`;
}

function judgeCriterionExplanations(
	criteria: string[],
	operations: Attempt["operations"],
): Array<string | undefined> {
	const judges = operations.filter((operation) => operation.kind === "evaluation");
	return criteria.map((_, index) =>
		judges
			.map((judge) => operationCriterionExplanations(criteria, judge)[index])
			.find((explanation) => explanation !== undefined),
	);
}

function ConversationSection({
	label,
	sectionOperations,
	allOperations,
	attempt,
}: {
	label: "Agents" | "Judges";
	sectionOperations: Attempt["operations"];
	allOperations: Attempt["operations"];
	attempt: Attempt;
}) {
	const [selectedId, setSelectedId] = useState(sectionOperations[0]?.id);
	if (!sectionOperations.length && (allOperations.length > 0 || label === "Judges")) return null;
	const selected =
		sectionOperations.find((operation) => operation.id === selectedId) ?? sectionOperations[0];
	const status =
		attempt.status === "running" ? (selected?.status ?? attempt.status) : attempt.status;
	return (
		<Conversation
			label={label}
			operation={selected}
			operations={sectionOperations}
			allOperations={allOperations}
			select={setSelectedId}
			status={status}
			attemptStatus={attempt.status}
			result={<AttemptResult result={selectedOperationResult(selected)} />}
		/>
	);
}

function attemptPresentation(attempt: Attempt, criteria: string[]) {
	return {
		operations: orderedAttemptOperations(attempt.operations, criteria),
		output: [...attempt.output.stdout, ...attempt.output.stderr].join("\n"),
		title: attempt.title.filter(Boolean).at(-1) ?? "Unnamed test",
	};
}

function selectedOperationResult(operation?: Attempt["operations"][number]) {
	return operationResult(operation ? [operation] : []);
}

function orderedAttemptOperations(
	operations: Attempt["operations"],
	criteria: string[],
): Attempt["operations"] {
	const entries = operations.map((operation, index) => ({
		operation,
		index,
		invocationIndex: operationInvocationIndex(operation),
	}));
	if (entries.some((entry) => entry.invocationIndex !== undefined))
		return entries
			.sort(
				(left, right) =>
					(left.invocationIndex ?? Number.POSITIVE_INFINITY) -
						(right.invocationIndex ?? Number.POSITIVE_INFINITY) || left.index - right.index,
			)
			.map((entry) => entry.operation);
	return entries
		.sort((left, right) => {
			if (operationIdentity(left.operation) !== operationIdentity(right.operation))
				return left.index - right.index;
			const leftOrdinal = inferredOperationOrdinal(criteria, left.operation);
			const rightOrdinal = inferredOperationOrdinal(criteria, right.operation);
			if (leftOrdinal === undefined || rightOrdinal === undefined) return left.index - right.index;
			return leftOrdinal - rightOrdinal || left.index - right.index;
		})
		.map((entry) => entry.operation);
}

function operationInvocationIndex(operation: Attempt["operations"][number]): number | undefined {
	if (typeof operation.invocationIndex === "number") return operation.invocationIndex;
	return operation.data.flatMap((value) => {
		if (!isRecord(value) || typeof value.invocationIndex !== "number") return [];
		return [value.invocationIndex];
	})[0];
}

/** Per-run metrics for comparing runs. Totals and checks live in the test verdict. */
function AttemptResult({ result }: { result: RunResultData }) {
	return <RunResult result={result} />;
}

function operationCriterionIndexes(
	criteria: string[],
	operation: Attempt["operations"][number] | undefined,
): number[] {
	return [
		...new Set(operation?.data.flatMap((item) => criterionRecordIndexes(criteria, item)) ?? []),
	];
}

function criterionRecordIndexes(criteria: string[], value: unknown): number[] {
	if (!isRecord(value)) return [];
	if (typeof value.criterion === "string") {
		const index = criteria.indexOf(value.criterion);
		return index < 0 ? [] : [index];
	}
	if (Array.isArray(value.criterionIndexes))
		return value.criterionIndexes.filter((index): index is number => Number.isInteger(index));
	return Number.isInteger(value.criterionIndex) ? [Number(value.criterionIndex)] : [];
}

const RUN_ORDINALS = ["first", "second", "third", "fourth", "fifth"];
const CRITERION_WORD_SEPARATOR = /[^a-z0-9]+/;

function inferredOperationOrdinal(
	criteria: string[],
	operation: Attempt["operations"][number],
): number | undefined {
	const output = operationResult([operation]).output?.trim().toLowerCase();
	if (!output) return undefined;
	const matches = criteria.flatMap((criterion) => {
		const ordinal = criterionRunOrdinal(criterion);
		const score = criterionOutputScore(criterion, output);
		return ordinal === undefined || score === 0 ? [] : [{ ordinal, score }];
	});
	const bestScore = Math.max(0, ...matches.map((match) => match.score));
	const ordinals = new Set(
		matches.filter((match) => match.score === bestScore).map((match) => match.ordinal),
	);
	return ordinals.size === 1 ? [...ordinals][0] : undefined;
}

function criterionOutputScore(criterion: string, output: string): number {
	const normalized = criterion.toLowerCase();
	if (normalized.includes(`exactly ${output}`)) return 2;
	return normalized.split(CRITERION_WORD_SEPARATOR).includes(output) ? 1 : 0;
}

function criterionRunOrdinal(criterion: string): number | undefined {
	const normalized = criterion.toLowerCase();
	const index = RUN_ORDINALS.findIndex((ordinal) => normalized.includes(`${ordinal} `));
	return index < 0 ? undefined : index;
}

function CopyFailureButton({ attempt, criteria }: { attempt: Attempt; criteria: string[] }) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(failureDebugText(attempt, criteria));
			setState("copied");
		} catch {
			setState("failed");
		}
	};
	return (
		<button
			type="button"
			aria-label="Copy failure details"
			{...stylex.props(styles.buttonReset, styles.copyFailureButton)}
			onClick={() => void copy()}
		>
			{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy details"}
		</button>
	);
}

function failureDebugText(attempt: Attempt, criteria: string[]): string {
	const result = operationResult(attempt.operations);
	const title = attempt.title.filter(Boolean);
	const output = [...attempt.output.stdout, ...attempt.output.stderr].join("\n");
	return [
		"Fix this agent test failure.",
		"Use the evidence below. Preserve the test's intent unless its expectation is incorrect.",
		"",
		`Test: ${title.at(-1) ?? "Unnamed test"}`,
		`Title path: ${title.join(" › ")}`,
		`Attempt: ${attempt.id}`,
		`Project: ${attempt.project || "default"}`,
		`Status: ${attempt.status}`,
		"",
		"Criteria:",
		...failureCriterionLines(attempt, criteria),
		"",
		"Errors:",
		...(attempt.errors.length
			? attempt.errors.map((error) => error.message ?? "Test failed")
			: ["(none)"]),
		"",
		"Conversation and tools:",
		...(result.timeline.length ? result.timeline.map(debugTimelineLine) : ["(none recorded)"]),
		"",
		"Test process output:",
		output || "(none)",
	].join("\n");
}

function failureCriterionLines(attempt: Attempt, criteria: string[]): string[] {
	return criteria.map((criterion, index) => {
		const outcome = criterionDisplayOutcome({
			criterion,
			index,
			results: attempt.criterionResults,
			status: attempt.status,
			errors: attempt.errors,
		});
		return `- [${outcome}] ${criterion}`;
	});
}

function debugTimelineLine(event: ConversationEvent): string {
	if (event.kind === "message") return `${event.message.role}: ${event.message.content}`;
	const args = event.tool.args ? ` ${JSON.stringify(event.tool.args)}` : "";
	const result = event.tool.result ? `\n  result: ${event.tool.result}` : "";
	return `tool ${event.tool.name}:${args}${result}`;
}

function TechnicalDetails({
	operations,
	output,
}: {
	operations: Attempt["operations"];
	output: string;
}) {
	return (
		<details {...stylex.props(styles.evidence)}>
			<summary {...stylex.props(styles.evidenceSummary)}>
				<span {...stylex.props(styles.disclosureIcon)}>›</span>
				Technical details
			</summary>
			<p {...stylex.props(styles.meta)}>
				Low-level evidence for debugging the test runner, separate from the agent conversation.
			</p>
			<EvidencePanel
				label="Test process logs (stdout / stderr)"
				value={output}
				empty="The test process did not write to stdout or stderr."
			/>
			<EvidencePanel
				label="Diagnostics"
				value={JSON.stringify(operations, null, 2)}
				empty="No diagnostics were captured."
			/>
		</details>
	);
}

function EvidencePanel({ label, value, empty }: { label: string; value: string; empty: string }) {
	return (
		<details {...stylex.props(styles.evidence)}>
			<summary {...stylex.props(styles.evidenceSummary)}>
				<span {...stylex.props(styles.disclosureIcon)}>›</span>
				{label}
			</summary>
			{value ? (
				<pre {...stylex.props(styles.pre)}>{value}</pre>
			) : (
				<p {...stylex.props(styles.meta)}>{empty}</p>
			)}
		</details>
	);
}

type TranscriptMessage = { role: string; content: string; seq?: number };
type TranscriptToolCall = {
	name: string;
	args?: Record<string, unknown>;
	result?: string;
	images?: ToolImage[];
	succeeded?: boolean;
	exitCode?: number;
	seq?: number;
};
type ConversationEvent =
	| { kind: "message"; message: TranscriptMessage }
	| { kind: "tool"; tool: TranscriptToolCall };
type RunResultData = {
	prompt?: string;
	output?: string;
	durationMs?: number;
	totalTokens?: number;
	toolCallCount?: number;
	changedPathCount?: number;
	timeline: ConversationEvent[];
};

function messagesFromOperation(value: unknown): TranscriptMessage[] {
	if (!isRecord(value)) return [];
	const trace = isRecord(value.trace)
		? value.trace
		: isRecord(value.conversation)
			? value.conversation
			: undefined;
	if (!trace || !Array.isArray(trace.messages)) return [];
	return uniqueMessages(
		trace.messages.flatMap((message) =>
			isRecord(message) && typeof message.role === "string" && typeof message.content === "string"
				? [{ role: message.role, content: message.content, seq: optionalNumber(message.seq) }]
				: [],
		),
	);
}

function toolCallsFromOperation(value: unknown): TranscriptToolCall[] {
	if (!isRecord(value)) return [];
	const trace = isRecord(value.trace)
		? value.trace
		: isRecord(value.conversation)
			? value.conversation
			: undefined;
	if (!trace || !Array.isArray(trace.toolCalls)) return [];
	return trace.toolCalls.flatMap((call) => {
		if (!isRecord(call) || typeof call.name !== "string") return [];
		return [
			{
				name: call.name,
				args: isRecord(call.args) ? call.args : undefined,
				result: optionalString(call.result),
				images: toolImages(call.images),
				succeeded: typeof call.succeeded === "boolean" ? call.succeeded : undefined,
				exitCode: optionalNumber(call.exitCode),
				seq: optionalNumber(call.seq),
			},
		];
	});
}

function operationResult(operations: Attempt["operations"]): RunResultData {
	const records = operations.flatMap((operation) => operation.data).filter(isRecord);
	const completed = [...records].reverse().find((value) => value.output !== undefined);
	const source = completed ?? records.at(-1);
	if (!source) return { timeline: [] };
	const prompt = records.map((record) => optionalString(record.prompt)).find(Boolean);
	return {
		prompt,
		output: conversationOutput(source.output),
		durationMs: optionalNumber(source.durationMs),
		totalTokens: nestedNumber(source.usage, "tokens", "total"),
		toolCallCount: optionalArrayLength(source.toolCalls),
		changedPathCount: nestedArrayLength(source.workspace, "changedPaths"),
		timeline: completed
			? conversationTimeline(source, prompt)
			: liveConversationTimeline(records, prompt),
	};
}

function conversationOutput(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return undefined;
	const reason = optionalString(value.reason);
	const facts = Object.entries(value)
		.filter(([key]) => key !== "reason")
		.map(([key, item]) => `${humanizeKey(key)}: ${formatConversationValue(item)}`);
	return [reason, ...facts].filter(Boolean).join("\n\n");
}

function humanizeKey(value: string): string {
	return value
		.replace(CAMEL_CASE_BOUNDARY, "$1 $2")
		.replace(INITIAL_CHARACTER, (letter) => letter.toUpperCase());
}

function formatConversationValue(value: unknown): string {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}

function liveConversationTimeline(
	records: Record<string, unknown>[],
	prompt?: string,
): ConversationEvent[] {
	const timeline: ConversationEvent[] = prompt
		? [{ kind: "message", message: { role: "user", content: prompt, seq: -1 } }]
		: [];
	for (const [index, record] of records.entries()) {
		const tool = liveToolEvent(record, index);
		if (tool) timeline.push(tool);
		if (record.type === "text" && typeof record.text === "string")
			appendLiveText(timeline, record.text, index);
	}
	return timeline;
}

function liveToolEvent(
	record: Record<string, unknown>,
	seq: number,
): ConversationEvent | undefined {
	if (record.type !== "tool" || typeof record.name !== "string") return undefined;
	return {
		kind: "tool",
		tool: {
			name: record.name,
			args: isRecord(record.args) ? record.args : undefined,
			result: optionalString(record.result),
			images: toolImages(record.images),
			exitCode: optionalNumber(record.exitCode),
			succeeded: typeof record.succeeded === "boolean" ? record.succeeded : undefined,
			seq,
		},
	};
}

function appendLiveText(timeline: ConversationEvent[], content: string, seq: number): void {
	const last = timeline.at(-1);
	if (last?.kind === "message" && last.message.role === "assistant") {
		last.message.content = content;
		return;
	}
	timeline.push({ kind: "message", message: { role: "assistant", content, seq } });
}

function conversationTimeline(
	source: Record<string, unknown>,
	prompt?: string,
): ConversationEvent[] {
	const tools = toolCallsFromOperation(source);
	const messages = messagesFromOperation(source).filter(
		(message) => message.role !== "tool" || tools.length === 0,
	);
	const judgeInput = judgeInputMessages(source.input);
	if (prompt && !messages.some((message) => message.role === "user" && message.content === prompt))
		messages.unshift({ role: "user", content: prompt, seq: -1 });
	const output = conversationOutput(source.output);
	if (judgeInput.length && output && !messages.some((message) => message.role === "assistant"))
		messages.push({ role: "assistant", content: output, seq: 1 });
	return [
		...judgeInput.map((message): ConversationEvent => ({ kind: "message", message })),
		...messages.map((message): ConversationEvent => ({ kind: "message", message })),
		...tools.map((tool): ConversationEvent => ({ kind: "tool", tool })),
	].sort((left, right) => eventOrder(left) - eventOrder(right));
}

function judgeInputMessages(value: unknown): TranscriptMessage[] {
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([key, item], index) => {
		if (typeof item !== "string") return [];
		return [
			{
				role: key === "answer" ? "Agent response" : humanizeKey(key),
				content: item,
				seq: index - Object.keys(value).length - 1,
			},
		];
	});
}

function eventOrder(event: ConversationEvent): number {
	const value = event.kind === "message" ? event.message.seq : event.tool.seq;
	if (value !== undefined) return value;
	if (event.kind === "tool") return 0;
	return event.message.role === "user" ? -1 : 1;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function optionalArrayLength(value: unknown): number | undefined {
	return Array.isArray(value) ? value.length : undefined;
}

function nestedNumber(value: unknown, parent: string, child: string): number | undefined {
	if (!isRecord(value) || !isRecord(value[parent])) return undefined;
	return optionalNumber(value[parent][child]);
}

function nestedArrayLength(value: unknown, key: string): number | undefined {
	return isRecord(value) ? optionalArrayLength(value[key]) : undefined;
}

function RunResult({ result }: { result: RunResultData }) {
	return (
		<section aria-label="Result" {...stylex.props(styles.resultPanel)}>
			<h3 {...stylex.props(styles.contentHeading)}>Result</h3>
			<ResultMetrics result={result} />
		</section>
	);
}

function FailureDetails({ message }: { message: string }) {
	const comparison = assertionComparison(message);
	if (!comparison)
		return <pre {...stylex.props(styles.pre, styles.error)}>{stripAnsi(message)}</pre>;
	return (
		<section aria-label="Expected vs received" {...stylex.props(styles.assertionCard)}>
			<strong {...stylex.props(styles.assertionTitle)}>Expected vs received</strong>
			<dl {...stylex.props(styles.assertionValues)}>
				<AssertionValue label="Expected" value={comparison.expected} />
				<AssertionValue label="Received" value={comparison.received} />
			</dl>
		</section>
	);
}

function AssertionValue({ label, value }: { label: string; value: string }) {
	return (
		<div {...stylex.props(styles.assertionValue)}>
			<dt {...stylex.props(styles.assertionLabel)}>{label}</dt>
			<dd {...stylex.props(styles.assertionCode)}>{value || "(empty)"}</dd>
		</div>
	);
}

type CriterionOutcome = "passed" | "failed" | "pending" | "not-recorded";
type CriterionPresentation = {
	criterion: string;
	outcome: CriterionOutcome;
	explanation?: string;
	failure?: string;
};

function criterionPresentations({
	criteria,
	explanations,
	results,
	status,
	errors,
}: {
	criteria: string[];
	explanations: Array<string | undefined>;
	results: Attempt["criterionResults"];
	status: string;
	errors: Attempt["errors"];
}): CriterionPresentation[] {
	const presentations = criteria.map((criterion, index) => ({
		criterion,
		explanation: explanations[index],
		outcome: criterionDisplayOutcome({ criterion, index, results, status, errors }),
	}));
	const failed = presentations.filter((item) => item.outcome === "failed");
	return presentations.map((item) => {
		const matched = errors.find((error) => criterionMatchesError(item.criterion, error.message));
		const onlyFailure = failed.length === 1 && errors.length === 1 ? errors[0] : undefined;
		return {
			...item,
			failure: item.outcome === "failed" ? (matched?.message ?? onlyFailure?.message) : undefined,
		};
	});
}

function CriterionResults({
	presentations,
	label = "Criterion results",
}: {
	presentations: CriterionPresentation[];
	label?: string;
}) {
	if (!presentations.length) return null;
	return (
		<section aria-label={label} {...stylex.props(styles.criterionResults)}>
			<ul {...stylex.props(styles.criterionResultList)}>
				{presentations.map((presentation) => (
					<CriterionResultRow
						key={presentation.criterion}
						criterion={presentation.criterion}
						outcome={presentation.outcome}
						explanation={presentation.explanation}
						failure={presentation.failure}
					/>
				))}
			</ul>
		</section>
	);
}

function criterionDisplayOutcome(input: {
	criterion: string;
	index: number;
	results: Attempt["criterionResults"];
	status: string;
	errors: Attempt["errors"];
}): CriterionOutcome {
	const outcome = criterionOutcome(input);
	if (outcome !== "not-recorded" || input.status !== "failed") return outcome;
	return input.errors.some((error) => criterionMatchesError(input.criterion, error.message))
		? "failed"
		: outcome;
}

function criterionMatchesError(criterion: string, message?: string): boolean {
	if (!message) return false;
	const comparison = assertionComparison(message);
	const expected = comparison?.expected.trim();
	return Boolean(expected && criterion.includes(expected));
}

function criterionOutcome({
	criterion,
	index,
	results,
	status,
}: {
	criterion: string;
	index: number;
	results: Attempt["criterionResults"];
	status: string;
}): CriterionOutcome {
	const recorded = results.find((result) => result.criterion === criterion) ?? results[index];
	if (recorded) return recorded.status;
	if (status === "passed") return "passed";
	if (status === "running") return "pending";
	return "not-recorded";
}

function CriterionResultRow({
	criterion,
	outcome,
	explanation,
	failure,
}: {
	criterion: string;
	outcome: CriterionOutcome;
	explanation?: string;
	failure?: string;
}) {
	const label = outcome === "not-recorded" ? "Not recorded" : capitalize(outcome);
	return (
		<li {...stylex.props(styles.criterionResult)}>
			<div {...stylex.props(styles.criterionResultHeader)}>
				<CriterionOutcomeIcon outcome={outcome} label={label} />
				<span>{criterion}</span>
			</div>
			{explanation ? <p {...stylex.props(styles.criterionExplanation)}>{explanation}</p> : null}
			{failure ? <FailureDetails message={failure} /> : null}
		</li>
	);
}

function CriterionOutcomeIcon({ outcome, label }: { outcome: CriterionOutcome; label: string }) {
	return (
		<span
			role="img"
			aria-label={label}
			{...stylex.props(
				styles.criterionOutcome,
				outcome === "passed" && styles.criterionOutcomePass,
				outcome === "failed" && styles.criterionOutcomeFail,
				outcome === "pending" && styles.criterionOutcomePending,
				outcome === "not-recorded" && styles.criterionOutcomeUnknown,
			)}
		>
			{criterionSymbol(outcome)}
		</span>
	);
}

function criterionSymbol(outcome: CriterionOutcome) {
	if (outcome === "passed") return "✓";
	if (outcome === "failed") return "×";
	if (outcome === "pending") return "…";
	return "–";
}

function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function ResultMetrics({ result }: { result: RunResultData }) {
	const metrics = [
		["Duration", result.durationMs === undefined ? "—" : formatDuration(result.durationMs)],
		["Tokens", result.totalTokens === undefined ? "—" : result.totalTokens.toLocaleString()],
		["Tool calls", result.toolCallCount === undefined ? "—" : String(result.toolCallCount)],
		[
			"Files changed",
			result.changedPathCount === undefined ? "—" : String(result.changedPathCount),
		],
	];
	return (
		<div {...stylex.props(styles.metricGrid)}>
			{metrics.map(([label, value]) => (
				<div key={label} {...stylex.props(styles.metric)}>
					<span {...stylex.props(styles.resourceFactLabel)}>{label}</span>
					<span {...stylex.props(styles.metricValue)}>{value}</span>
				</div>
			))}
		</div>
	);
}

const SECTION_INTROS = {
	Agents: "The task each agent received and how it answered.",
	Judges: "A separate reviewer graded the agent answers below. Its findings feed the checks above.",
} as const;

function Conversation({
	label,
	operation,
	operations,
	allOperations,
	select,
	status,
	attemptStatus,
	result,
}: {
	label: "Agents" | "Judges";
	operation?: Attempt["operations"][number];
	operations: Attempt["operations"];
	allOperations: Attempt["operations"];
	select: (id: string) => void;
	status: string;
	attemptStatus: string;
	result: ReactNode;
}) {
	const { timeline, judge } = conversationContent(operation, operations);
	return (
		<section aria-label={label} {...stylex.props(styles.conversation)}>
			<div {...stylex.props(styles.conversationSurface)}>
				<header {...stylex.props(styles.conversationHeader)}>
					<h3 {...stylex.props(styles.contentHeading)}>{label}</h3>
					<p {...stylex.props(styles.sectionIntro)}>{SECTION_INTROS[label]}</p>
				</header>
				<ConversationTabs
					label={label}
					operations={operations}
					selected={operation}
					select={select}
					attemptStatus={attemptStatus}
				/>
				<ConversationRunTabs operation={operation} operations={operations} select={select} />
				{operation?.kind === "evaluation" || operations.length < 2 ? null : result}
				<section aria-label={`${label} messages`} {...stylex.props(styles.conversationThread)}>
					{judge ? (
						<>
							<JudgeAsked review={judge} />
							<JudgeResponse review={judge} operations={allOperations} />
							<JudgeInputs review={judge} operations={allOperations} />
						</>
					) : (
						<ConversationEvents timeline={timeline} />
					)}
				</section>
				{timeline.length === 0 && status !== "running" ? (
					<p {...stylex.props(styles.meta)}>{conversationPlaceholder(status)}</p>
				) : null}
				{status === "running" ? <RunningIndicator kind={operation?.kind} /> : null}
			</div>
		</section>
	);
}

function conversationContent(
	operation: Attempt["operations"][number] | undefined,
	operations: Attempt["operations"],
): { timeline: ConversationEvent[]; judge?: JudgeReviewData } {
	if (operation?.kind === "evaluation") {
		const judge = judgeReviewData(operation);
		return {
			judge,
			timeline: judge.question
				? [
						{
							kind: "message",
							message: { role: "Judge question", content: judge.question, seq: -1 },
						},
					]
				: [],
		};
	}
	const result = operationResult(operation ? [operation] : []);
	return {
		timeline: [...legacyJudgeInput(operation, operations), ...recordedTimeline(result)],
	};
}

function recordedTimeline(result: RunResultData): ConversationEvent[] {
	if (result.timeline.length) return result.timeline;
	if (!result.output) return [];
	return [{ kind: "message", message: { role: "assistant", content: result.output } }];
}

function ConversationEvents({ timeline }: { timeline: ConversationEvent[] }) {
	return timeline.map((event, index) =>
		event.kind === "tool" ? (
			<ToolActivity key={`tool:${event.tool.seq ?? index}:${event.tool.name}`} tool={event.tool} />
		) : (
			<MessageBubble
				key={`message:${event.message.seq ?? index}:${event.message.role}`}
				message={event.message}
			/>
		),
	);
}

type JudgeReviewData = {
	question?: string;
	context: Array<{ label: string; value: string; rawValue: unknown }>;
	outcomes: Array<{ label: string; passed: boolean; explanation?: string }>;
	reason?: string;
};

/** The judge's instruction comes first: it defines what each finding below means. */
function JudgeAsked({ review }: { review: JudgeReviewData }) {
	if (!review.question) return null;
	return (
		<section aria-label="Judge question" {...stylex.props(styles.judgeQuestion)}>
			<p {...stylex.props(styles.judgeQuestionText)}>
				<span {...stylex.props(styles.judgeAskedLabel)}>Asked</span>
				<span>{review.question}</span>
			</p>
		</section>
	);
}

/** Everything the test sent the judge, folded away: it mostly repeats the agent answers. */
function JudgeInputs({
	review,
	operations,
}: {
	review: JudgeReviewData;
	operations: Attempt["operations"];
}) {
	if (!review.context.length) return null;
	// Inputs matter most before findings exist and when a finding failed.
	const inputsFirst =
		review.outcomes.length === 0 || review.outcomes.some((outcome) => !outcome.passed);
	return (
		<section aria-label="Context included">
			<details data-disclosure open={inputsFirst} {...stylex.props(styles.judgeContextDisclosure)}>
				<summary {...stylex.props(styles.judgeContextSummary)}>
					What the judge saw · {review.context.length} selected{" "}
					{pluralize(review.context.length, "field")}
				</summary>
				<JudgeContext context={review.context} operations={operations} />
			</details>
		</section>
	);
}

type JudgeAnswerContext = JudgeReviewData["context"][number] & {
	id: string;
	tabLabel: string;
};

function JudgeContext({
	context,
	operations,
}: {
	context: JudgeReviewData["context"];
	operations: Attempt["operations"];
}) {
	const { answers, supplied } = judgeContextGroups(context, operations);
	const [selectedId, setSelectedId] = useState(answers[0]?.id);
	const selected = answers.find((item) => item.id === selectedId) ?? answers[0];
	const panelId = useId();
	return (
		<div {...stylex.props(styles.judgeContext)}>
			<p {...stylex.props(styles.judgeContextNote)}>
				Only these fields, chosen by the test, were sent to the judge.
			</p>
			{answers.length ? (
				<section aria-label="Agent answers" {...stylex.props(styles.judgeContextGroup)}>
					<h5 {...stylex.props(styles.judgeContextGroupHeading)}>Agent answers</h5>
					<div
						role="tablist"
						aria-label="Agent answers included"
						{...stylex.props(styles.judgeContextTabs)}
					>
						{answers.map((answer, index) => (
							<button
								key={answer.id}
								type="button"
								role="tab"
								aria-selected={answer.id === selected?.id}
								aria-controls={panelId}
								{...stylex.props(
									styles.buttonReset,
									styles.judgeContextTab,
									answer.id === selected?.id && styles.judgeContextTabActive,
								)}
								onClick={() => setSelectedId(answer.id)}
								onKeyDown={(event) =>
									selectContextWithKeyboard({ event, answers, index, select: setSelectedId })
								}
							>
								{answer.tabLabel}
							</button>
						))}
					</div>
					{selected ? (
						<div
							id={panelId}
							role="tabpanel"
							aria-label={`Agent response from ${selected.tabLabel}`}
							{...stylex.props(styles.judgeContextAnswer)}
						>
							<div {...stylex.props(styles.judgeContextValue)}>
								<div className="message-markdown">
									<Markdown>{normalizeTranscriptMarkdown(selected.value)}</Markdown>
								</div>
							</div>
						</div>
					) : null}
				</section>
			) : null}
			{supplied.length ? (
				<section aria-label="Additional context" {...stylex.props(styles.judgeContextGroup)}>
					<h5 {...stylex.props(styles.judgeContextGroupHeading)}>Additional context</h5>
					<dl {...stylex.props(styles.judgeContextList)}>
						{supplied.map((item) => (
							<div key={item.label} {...stylex.props(styles.judgeContextItem)}>
								<dt {...stylex.props(styles.judgeContextLabel)}>{item.label}</dt>
								<dd {...stylex.props(styles.judgeContextValue)}>{item.value}</dd>
							</div>
						))}
					</dl>
				</section>
			) : null}
		</div>
	);
}

function judgeContextGroups(
	context: JudgeReviewData["context"],
	operations: Attempt["operations"],
): { answers: JudgeAnswerContext[]; supplied: JudgeReviewData["context"] } {
	const candidates = operations
		.filter((operation) => operation.kind !== "evaluation")
		.map((operation) => ({ operation, output: operationOutput(operation) }));
	const claimed = new Set<string>();
	const answers: JudgeAnswerContext[] = [];
	const supplied: JudgeReviewData["context"] = [];
	for (const [index, item] of context.entries()) {
		const match = candidates.find(
			(candidate) =>
				!claimed.has(candidate.operation.id) && sameContextValue(item.rawValue, candidate.output),
		);
		if (!match) {
			supplied.push(item);
			continue;
		}
		claimed.add(match.operation.id);
		answers.push({
			...item,
			id: `${match.operation.id}:${index}`,
			tabLabel: agentRunLabel(match.operation, operations),
		});
	}
	return { answers, supplied };
}

function operationOutput(operation: Attempt["operations"][number]): unknown {
	const records = operation.data.filter(isRecord);
	return [...records].reverse().find((record) => record.output !== undefined)?.output;
}

function sameContextValue(left: unknown, right: unknown): boolean {
	if (right === undefined) return false;
	if (left === right) return true;
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}

function agentRunLabel(
	operation: Attempt["operations"][number],
	operations: Attempt["operations"],
): string {
	const peers = operations.filter(
		(item) =>
			item.kind !== "evaluation" && operationIdentity(item) === operationIdentity(operation),
	);
	const name = conversationLabel(operation);
	if (peers.length < 2) return name;
	return `${name} · Run ${peers.findIndex((item) => item.id === operation.id) + 1}`;
}

function selectContextWithKeyboard(input: {
	event: KeyboardEvent<HTMLButtonElement>;
	answers: JudgeAnswerContext[];
	index: number;
	select: (id: string) => void;
}): void {
	const { event, answers, index, select } = input;
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const direction = event.key === "ArrowRight" ? 1 : -1;
	const nextIndex = (index + direction + answers.length) % answers.length;
	const next = answers[nextIndex];
	if (!next) return;
	select(next.id);
	event.currentTarget.parentElement
		?.querySelectorAll<HTMLButtonElement>("[role=tab]")
		[nextIndex]?.focus();
}

function JudgeResponse({
	review,
	operations,
}: {
	review?: JudgeReviewData;
	operations: Attempt["operations"];
}) {
	if (!review || (!review.outcomes.length && !review.reason)) return null;
	const { answers, supplied } = judgeContextGroups(review.context, operations);
	return (
		<JudgeFindings
			outcomes={review.outcomes}
			reason={review.reason}
			answers={answers}
			references={supplied.filter((item) => item.value.length <= SHORT_REFERENCE)}
		/>
	);
}

const SHORT_REFERENCE = 120;
const ANSWER_QUOTE = 160;

/**
 * One row per judged field, quoting the answer it judged, then the short reference values the
 * test supplied and the judge's shared reason. Together they show why each row passed or failed.
 */
function JudgeFindings({
	outcomes,
	reason,
	answers = [],
	references = [],
}: {
	outcomes: JudgeReviewData["outcomes"];
	reason?: string;
	answers?: JudgeAnswerContext[];
	references?: JudgeReviewData["context"];
}) {
	return (
		<section aria-label="Judge response" {...stylex.props(styles.judgeResponse)}>
			<h4 {...stylex.props(styles.judgeResponseHeading)}>Findings</h4>
			<div {...stylex.props(styles.judgeOutcomeList)}>
				{outcomes.map((outcome) => (
					<JudgeFindingRow key={outcome.label} outcome={outcome} answers={answers} />
				))}
			</div>
			{outcomes.length && references.length ? (
				<p {...stylex.props(styles.judgeReason)}>
					<span {...stylex.props(styles.judgeAskedLabel)}>Compared with</span>
					{references.map((item) => `${item.label}: ${item.value}`).join(" · ")}
				</p>
			) : null}
			{reason ? (
				<p {...stylex.props(styles.judgeReason)}>
					{outcomes.length ? <span {...stylex.props(styles.judgeAskedLabel)}>Reason</span> : null}
					<span>{reason}</span>
				</p>
			) : null}
		</section>
	);
}

function JudgeFindingRow({
	outcome,
	answers,
}: {
	outcome: JudgeReviewData["outcomes"][number];
	answers: JudgeAnswerContext[];
}) {
	const answer = judgedAnswer(outcome, answers);
	return (
		<div {...stylex.props(styles.judgeOutcome)}>
			<CriterionOutcomeIcon
				outcome={outcome.passed ? "passed" : "failed"}
				label={outcome.passed ? "Passed" : "Failed"}
			/>
			<span {...stylex.props(styles.judgeOutcomeLabel)}>{judgeOutcomeLabel(outcome, answer)}</span>
			{outcome.explanation ? (
				<p {...stylex.props(styles.judgeOutcomeExplanation)}>{outcome.explanation}</p>
			) : null}
			{answer ? (
				<p {...stylex.props(styles.judgeOutcomeExplanation)}>“{answerQuote(answer.value)}”</p>
			) : null}
		</div>
	);
}

/** The answer a field is named after: "fileRoundOneCorrect" judges the "fileRoundOne" input. */
function judgedAnswer(
	outcome: JudgeReviewData["outcomes"][number],
	answers: JudgeAnswerContext[],
): JudgeAnswerContext | undefined {
	return answers.find(
		(item) => outcome.label === item.label || outcome.label.startsWith(`${item.label} `),
	);
}

/**
 * A finding is named by what the judge looked at, in the test's own words: the input label
 * ("File round one") when the field judges an answer, otherwise the field ("Explains risk").
 * The pass/fail icon carries the verdict, so the label never repeats it.
 */
function judgeOutcomeLabel(
	outcome: JudgeReviewData["outcomes"][number],
	answer: JudgeAnswerContext | undefined,
): string {
	return sentenceCase(answer?.label ?? outcome.label);
}

function sentenceCase(value: string): string {
	const lower = value.toLowerCase();
	return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function answerQuote(value: string): string {
	const plain = value
		.replace(/[*_`#>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return plain.length > ANSWER_QUOTE ? `${plain.slice(0, ANSWER_QUOTE - 1)}…` : plain;
}

function judgeReviewData(operation: Attempt["operations"][number]): JudgeReviewData {
	const records = operation.data.filter(isRecord);
	const record = [...records].reverse().find((item) => item.output !== undefined) ?? records.at(-1);
	const output = isRecord(record?.output) ? record.output : {};
	const reason = optionalString(output.reason) ?? conversationOutput(record?.output);
	return {
		question: judgeQuestion(record),
		context: judgeContext(record?.input),
		outcomes: judgeOutcomes(output),
		reason,
	};
}

function judgeContext(value: unknown): JudgeReviewData["context"] {
	if (value === undefined) return [];
	if (!isRecord(value))
		return [{ label: "Selected input", value: judgeContextValue(value), rawValue: value }];
	return Object.entries(value).map(([key, item]) => ({
		label: humanizeKey(key),
		value: judgeContextValue(item),
		rawValue: item,
	}));
}

function judgeContextValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return String(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value, null, 2);
}

function judgeQuestion(record: Record<string, unknown> | undefined): string | undefined {
	const evaluation = isRecord(record?.evaluation) ? record.evaluation : undefined;
	return optionalString(evaluation?.prompt);
}

/** Only an explanation the judge gave for that field attaches to it; a shared reason never does. */
function judgeOutcomes(output: Record<string, unknown>): JudgeReviewData["outcomes"] {
	const entries = Object.entries(output).filter(
		(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
	);
	return entries.map(([key, passed]) => ({
		label: humanizeKey(key),
		passed,
		explanation: judgeOutcomeExplanation(output, key),
	}));
}

function judgeOutcomeExplanation(output: Record<string, unknown>, key: string): string | undefined {
	const explanations = isRecord(output.explanations) ? output.explanations : {};
	return (
		optionalString(explanations[key]) ??
		optionalString(output[`${key}Explanation`]) ??
		optionalString(output[`${key}Reason`])
	);
}

function operationCriterionExplanations(
	criteria: string[],
	operation: Attempt["operations"][number] | undefined,
): Array<string | undefined> {
	const explanations = Array<string | undefined>(criteria.length);
	if (operation?.kind !== "evaluation") return explanations;
	const indexes = operationCriterionIndexes(criteria, operation);
	const outcomes = judgeReviewData(operation).outcomes;
	indexes.forEach((criterionIndex, outcomeIndex) => {
		explanations[criterionIndex] = outcomes[outcomeIndex]?.explanation;
	});
	return explanations;
}

function legacyJudgeInput(
	operation: Attempt["operations"][number] | undefined,
	operations: Attempt["operations"],
): ConversationEvent[] {
	if (!operation || operation.kind !== "evaluation") return [];
	if (operation.data.some((item) => isRecord(item) && isRecord(item.input))) return [];
	const index = operations.findIndex((item) => item.id === operation.id);
	const agent = operations
		.slice(0, index)
		.reverse()
		.find((item) => item.kind === "agent");
	if (!agent) return [];
	const result = operationResult([agent]);
	const timeline: ConversationEvent[] = [];
	if (result.prompt)
		timeline.push({
			kind: "message",
			message: { role: "Task", content: result.prompt, seq: -3 },
		});
	if (result.output)
		timeline.push({
			kind: "message",
			message: { role: "Agent response", content: result.output, seq: -2 },
		});
	return timeline;
}

function ConversationTabs({
	label,
	operations,
	selected,
	select,
	attemptStatus,
}: {
	label: "Agents" | "Judges";
	operations: Attempt["operations"];
	selected?: Attempt["operations"][number];
	select: (id: string) => void;
	attemptStatus: string;
}) {
	if (!operations.length) return null;
	const groups = conversationGroups(operations);
	const representatives = groups.map((group) => group.operations[0]);
	const selectedGroup = selected ? operationIdentity(selected) : undefined;
	return (
		<div
			role="tablist"
			aria-label={`${label} participants`}
			{...stylex.props(styles.conversationSwitcher, styles.conversationTabs)}
		>
			{groups.map((group, index) => (
				<ConversationTab
					key={group.key}
					operation={group.operations[0]}
					active={group.key === selectedGroup}
					status={conversationGroupStatus(group.operations, attemptStatus)}
					onSelect={() => select(group.operations[0].id)}
					onKeyDown={(event) =>
						selectConversationWithKeyboard({
							event,
							operations: representatives,
							index,
							select,
						})
					}
				/>
			))}
		</div>
	);
}

function ConversationTab({
	operation,
	active,
	status,
	onSelect,
	onKeyDown,
}: {
	operation?: Attempt["operations"][number];
	active: boolean;
	status: "done" | "running" | "stopped";
	onSelect: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-label={conversationLabel(operation)}
			aria-selected={active}
			{...stylex.props(
				styles.buttonReset,
				styles.conversationTab,
				active && styles.conversationTabActive,
			)}
			onClick={onSelect}
			onKeyDown={onKeyDown}
		>
			<span
				role="status"
				aria-label={`${operation?.name ?? "Operation"} is ${status}`}
				{...stylex.props(
					styles.conversationTabDot,
					status === "done" && styles.conversationTabDotDone,
					status === "running" && styles.conversationTabDotRunning,
					status === "stopped" && styles.conversationTabDotStopped,
				)}
			/>
			{conversationLabel(operation)}
		</button>
	);
}

function conversationLabel(operation?: Attempt["operations"][number]): string {
	return operation?.name ?? "Unnamed";
}

type Operation = Attempt["operations"][number];
type ConversationGroup = { key: string; operations: [Operation, ...Operation[]] };

function conversationGroups(operations: Attempt["operations"]): ConversationGroup[] {
	const groups = new Map<string, ConversationGroup>();
	for (const operation of operations) {
		const key = operationIdentity(operation);
		const group = groups.get(key);
		if (group) group.operations.push(operation);
		else groups.set(key, { key, operations: [operation] });
	}
	return [...groups.values()];
}

function conversationGroupStatus(
	operations: Attempt["operations"],
	attemptStatus: string,
): "done" | "running" | "stopped" {
	if (
		operations.some(
			(operation) => operation.status === "failed" || operation.status === "interrupted",
		)
	)
		return "stopped";
	if (operations.some((operation) => operation.status === "running")) {
		if (attemptStatus === "running") return "running";
		if (attemptStatus === "interrupted" || attemptStatus === "failed") return "stopped";
	}
	return "done";
}

function operationIdentity(operation: Attempt["operations"][number]): string {
	return `${operation.name ?? "Unnamed"}\u0000${operation.kind}`;
}

function ConversationRunTabs({
	operation,
	operations,
	select,
}: {
	operation?: Attempt["operations"][number];
	operations: Attempt["operations"];
	select: (id: string) => void;
}) {
	if (!operation) return null;
	const runs = operations.filter(
		(item) => operationIdentity(item) === operationIdentity(operation),
	);
	if (runs.length < 2) return null;
	return (
		<div
			role="tablist"
			aria-label={`${operation.name ?? "Agent"} runs`}
			{...stylex.props(styles.runTabs)}
		>
			{runs.map((run, index) => (
				<button
					key={run.id}
					type="button"
					role="tab"
					aria-selected={run.id === operation.id}
					{...stylex.props(
						styles.buttonReset,
						styles.runTab,
						run.id === operation.id && styles.runTabActive,
					)}
					onClick={() => select(run.id)}
					onKeyDown={(event) =>
						selectConversationWithKeyboard({ event, operations: runs, index, select })
					}
				>
					Run {index + 1}
				</button>
			))}
		</div>
	);
}

function selectConversationWithKeyboard(input: {
	event: KeyboardEvent<HTMLButtonElement>;
	operations: Attempt["operations"];
	index: number;
	select: (id: string) => void;
}): void {
	const { event, operations, index, select } = input;
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	const direction = event.key === "ArrowRight" ? 1 : -1;
	const next = operations[(index + direction + operations.length) % operations.length];
	if (!next) return;
	select(next.id);
	const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]");
	tabs?.[(index + direction + operations.length) % operations.length]?.focus();
}

function RunningIndicator({ kind }: { kind?: Attempt["operations"][number]["kind"] }) {
	const participant = kind === "evaluation" ? "Judge" : "Agent";
	return (
		<div
			role="status"
			aria-label={`${participant} is running`}
			{...stylex.props(styles.runningIndicator)}
		>
			<span>Running</span>
			<span aria-hidden="true" {...stylex.props(styles.runningDots)}>
				<span {...stylex.props(styles.runningDot)}>•</span>
				<span {...stylex.props(styles.runningDot, styles.runningDotSecond)}>•</span>
				<span {...stylex.props(styles.runningDot, styles.runningDotThird)}>•</span>
			</span>
		</div>
	);
}

function ToolActivity({ tool }: { tool: TranscriptToolCall }) {
	const presentation = toolPresentation(tool);
	const [outputOpen, setOutputOpen] = useState(false);
	return (
		<article {...stylex.props(styles.toolEvent)}>
			<span aria-hidden="true" {...stylex.props(styles.toolIcon)}>
				{presentation.icon}
			</span>
			<div {...stylex.props(styles.toolCopy)}>
				<strong {...stylex.props(styles.toolTitle)}>{presentation.title}</strong>
				{presentation.detail ? (
					<span title={presentation.detail} {...stylex.props(styles.toolDetail)}>
						{presentation.detail}
					</span>
				) : null}
			</div>
			<div role="group" aria-label="Tool controls" {...stylex.props(styles.toolActions)}>
				<span {...stylex.props(styles.toolOutcome, presentation.failed && styles.toolOutcomeFail)}>
					{presentation.outcome}
				</span>
				{tool.result ? (
					<button
						type="button"
						{...stylex.props(styles.buttonReset, styles.toolResultSummary)}
						onClick={() => setOutputOpen((open) => !open)}
					>
						{outputOpen ? "Hide output" : "View output"}
					</button>
				) : null}
			</div>
			{tool.result && outputOpen ? (
				<pre {...stylex.props(styles.toolResultPre)}>{tool.result}</pre>
			) : null}
			{tool.images ? <ToolImages images={tool.images} toolName={presentation.title} /> : null}
		</article>
	);
}

function toolPresentation(tool: TranscriptToolCall) {
	const name = tool.name.toLowerCase();
	const failed = tool.succeeded === false || (tool.exitCode !== undefined && tool.exitCode !== 0);
	const outcome =
		tool.exitCode !== undefined ? `Exit ${tool.exitCode}` : failed ? "Failed" : "Completed";
	if (name === "read" || name.includes("read_file"))
		return { icon: "↗", title: "Read file", detail: argument(tool, "path"), outcome, failed };
	if (["shell", "bash", "exec_command"].includes(name))
		return {
			icon: ">",
			title: "Run command",
			detail: unwrapShellCommand(argument(tool, "command")),
			outcome,
			failed,
		};
	if (name.includes("edit") || name.includes("write"))
		return { icon: "✎", title: "Change file", detail: argument(tool, "path"), outcome, failed };
	return { icon: "◆", title: tool.name, detail: summarizeArgs(tool.args), outcome, failed };
}

function argument(tool: TranscriptToolCall, key: string): string {
	const value = tool.args?.[key];
	return typeof value === "string" ? value : summarizeArgs(tool.args);
}

function summarizeArgs(args?: Record<string, unknown>): string {
	if (!args || Object.keys(args).length === 0) return "";
	const value = JSON.stringify(args);
	return value.length > 140 ? `${value.slice(0, 137)}…` : value;
}

function MessageBubble({ message }: { message: TranscriptMessage }) {
	return (
		<div
			{...stylex.props(
				styles.message,
				(message.role === "user" || message.role === "Task" || message.role === "Judge question") &&
					styles.messageUser,
				(message.role === "assistant" || message.role === "Agent response") &&
					styles.messageAssistant,
				message.role === "Judge response" && styles.messageJudge,
			)}
		>
			<span {...stylex.props(styles.messageRole)}>{message.role}</span>
			<div {...stylex.props(styles.messageContent)}>
				<div className="message-markdown">
					<Markdown>{normalizeTranscriptMarkdown(message.content)}</Markdown>
				</div>
			</div>
		</div>
	);
}

function normalizeTranscriptMarkdown(content: string): string {
	return content.replace(LOCAL_PATH_LINK, (_match, label: string) => `\`${label}\``);
}

function uniqueMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
	const seen = new Set<string>();
	return messages.filter((message) => {
		const key = `${message.role}\u0000${message.content}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function formatDuration(durationMs: number): string {
	return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

function pluralize(count: number, noun: string): string {
	return count === 1 ? noun : `${noun}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function OperationList({ operations }: { operations: Attempt["operations"] }) {
	if (operations.length === 0) return null;
	const summaries = summarizeOperations(operations);
	return (
		<div {...stylex.props(styles.ranRow)}>
			<span {...stylex.props(styles.ranLabel)}>Ran</span>
			{summaries.map((summary) => (
				<span key={summary.key} {...stylex.props(styles.ranChip)}>
					{summary.name}
					{summary.count > 1 ? ` ×${summary.count}` : ""}
				</span>
			))}
		</div>
	);
}

function summarizeOperations(operations: Attempt["operations"]): Array<{
	key: string;
	name: string;
	count: number;
}> {
	const summaries = new Map<string, { key: string; name: string; count: number }>();
	for (const operation of operations) {
		const name = operation.name ?? operation.kind;
		const key = operationIdentity(operation);
		const existing = summaries.get(key);
		if (existing) existing.count++;
		else summaries.set(key, { key, name, count: 1 });
	}
	return [...summaries.values()];
}

function latestTestStatuses(executions: ExecutionSummary[]) {
	const statuses = new Map<string, TestStatusValue>();
	for (const execution of executions) {
		for (const testId of execution.testIds ?? []) {
			const status = testRunStatus(execution, testId);
			const known = statuses.get(testId);
			if (known === undefined || (known === "skipped" && status !== "skipped"))
				statuses.set(testId, status);
		}
	}
	return statuses;
}

function groupTests(tests: TestRecord[]) {
	const groups = new Map<string, TestRecord[]>();
	for (const test of tests) {
		const name = test.title.slice(0, -1).join(" › ") || test.file;
		groups.set(name, [...(groups.get(name) ?? []), test]);
	}
	return groups;
}
