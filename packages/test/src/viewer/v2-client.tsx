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
import { createContext, type KeyboardEvent, useContext, useState } from "react";
import Markdown from "react-markdown";
import { viewerApi } from "./generated-api.js";
import {
	assertionComparison,
	conversationPlaceholder,
	preferredExecutionId,
	stripAnsi,
} from "./presentation.js";
import type { TestCatalog, DiscoveredTest as TestRecord } from "./test-catalog.js";

type ExecutionSummary = {
	id: string;
	startedAt: string;
	finishedAt?: string;
	testIds?: string[];
	status: "running" | "passed" | "failed" | "interrupted";
	testStatuses?: Record<string, TestStatusValue>;
};
type TestStatusValue = "queued" | "running" | "passed" | "failed" | "skipped" | "interrupted";
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
	operations: Array<{ id: string; kind: string; name?: string; status: string; data: unknown[] }>;
};
type ExecutionDetail = ExecutionSummary & { attempts: Attempt[]; cancellable?: boolean };
type TestView = "current" | "setup" | "history";
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;
const LOCAL_PATH_LINK = /\[([^\]]+)\]\(<local-path>[^)]*\)/g;

const runningPulse = stylex.keyframes({
	"0%, 60%, 100%": { opacity: 0.3, transform: "translateY(0)" },
	"30%": { opacity: 1, transform: "translateY(-2px)" },
});
const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;
const INITIAL_CHARACTER = /^./;
const WorkerContext = createContext<{
	workers: number;
	setWorkers: (workers: number) => void;
}>({ workers: 1, setWorkers: () => undefined });

const rootRoute = createRootRoute({ component: ViewerLayout });
const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: TestCatalogPage,
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
	component: ExecutionPage,
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
			"@media (max-width: 620px)": "1fr",
		},
		height: "100dvh",
		minHeight: 0,
	},
	shellCollapsed: { gridTemplateColumns: "3.75rem minmax(0, 1fr)" },
	sidebar: {
		borderRight: "1px solid var(--border)",
		overflow: "hidden",
		display: "flex",
		flexDirection: "column",
		padding: "1rem 0 0",
		backgroundColor: "var(--sidebar)",
		minHeight: 0,
		height: { default: "100dvh", "@media (max-width: 620px)": "auto" },
		maxHeight: { default: "none", "@media (max-width: 620px)": "18rem" },
	},
	sidebarCollapsed: { paddingTop: "1rem", height: "100dvh", maxHeight: "none" },
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
		justifyContent: "flex-end",
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
		alignItems: "center",
		justifyContent: "space-between",
		gap: "0.75rem",
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
	conversationTabs: { display: "flex", flexWrap: "wrap", gap: "0.25rem" },
	conversationTab: {
		display: "inline-flex",
		alignItems: "center",
		gap: "0.2rem",
		boxSizing: "border-box",
		height: "1.1rem",
		minHeight: 0,
		lineHeight: 1,
		padding: "0.08rem 0.32rem",
		fontSize: "0.5rem",
		fontWeight: 750,
		letterSpacing: "0.04em",
		textTransform: "uppercase",
		borderColor: "var(--border)",
		backgroundColor: { default: "transparent", ":hover": "var(--panel-3)" },
		color: "var(--muted)",
		cursor: "pointer",
	},
	conversationTabActive: {
		borderColor: "var(--pass)",
		backgroundColor: "var(--pass-soft)",
		color: "var(--pass)",
	},
	conversationTabDot: {
		width: "0.28rem",
		height: "0.28rem",
		borderRadius: 999,
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
	judgeResponse: {
		display: "grid",
		justifySelf: "start",
		gap: "0.4rem",
		padding: "0.65rem 0.7rem",
		border: "1px solid var(--border)",
		borderRadius: 10,
		backgroundColor: "var(--panel-2)",
		maxWidth: "78%",
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
	criterionIcon: { color: "var(--accent)", fontWeight: 800 },
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
	const [workers, setWorkers] = useState(1);
	return (
		<WorkerContext.Provider value={{ workers, setWorkers }}>
			<div {...stylex.props(styles.shell, !sidebarOpen && styles.shellCollapsed)}>
				<a href="#viewer-main" {...stylex.props(styles.skipLink)}>
					Skip to content
				</a>
				<ViewerSidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
				<main id="viewer-main" tabIndex={-1} {...stylex.props(styles.main)}>
					<Outlet />
				</main>
			</div>
		</WorkerContext.Provider>
	);
}

function useCatalog() {
	return useQuery({ queryKey: ["test-catalog"], queryFn: fetchTestCatalog });
}
function ViewerSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	const catalog = useCatalog();
	const history = useExecutionHistory();
	const groups = groupTests(catalog.data?.tests ?? []);
	const statuses = latestTestStatuses(history.data ?? []);
	return (
		<aside {...stylex.props(styles.sidebar, !open && styles.sidebarCollapsed)}>
			<SidebarHeader open={open} count={catalog.data?.tests.length ?? 0} onToggle={onToggle} />
			{open ? (
				<SidebarNavigation groups={groups} statuses={statuses} error={catalog.isError} />
			) : null}
		</aside>
	);
}

function SidebarHeader({
	open,
	count,
	onToggle,
}: {
	open: boolean;
	count: number;
	onToggle: () => void;
}) {
	const { workers } = useContext(WorkerContext);
	const navigate = useNavigate();
	const client = useQueryClient();
	const run = useMutation({
		mutationFn: () => startSuite(workers),
		onSuccess: ({ executionId }) => {
			void client.invalidateQueries({ queryKey: ["execution-history"] });
			void navigate({ to: "/executions/$executionId", params: { executionId } });
		},
	});
	return (
		<header {...stylex.props(styles.sidebarHeader, !open && styles.sidebarHeaderCollapsed)}>
			{open ? (
				<>
					<div {...stylex.props(styles.sidebarTitleRow)}>
						<div {...stylex.props(styles.sidebarTitleIdentity)}>
							<h1 {...stylex.props(styles.title, styles.sidebarTitle)}>Tests</h1>
							<span {...stylex.props(styles.countBadge)}>{count}</span>
						</div>
						<SidebarToggle open={open} onToggle={onToggle} />
					</div>
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
				<SidebarToggle open={open} onToggle={onToggle} />
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

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			aria-controls="test-navigation"
			aria-expanded={open}
			aria-label={open ? "Collapse test sidebar" : "Expand test sidebar"}
			{...stylex.props(styles.buttonReset, styles.toggleButton)}
			onClick={onToggle}
		>
			{open ? "←" : "→"}
		</button>
	);
}

function SidebarNavigation({
	groups,
	statuses,
	error,
}: {
	groups: Map<string, TestRecord[]>;
	statuses: Map<string, TestStatusValue>;
	error: boolean;
}) {
	return (
		<>
			{error ? <p role="alert">Test discovery is unavailable.</p> : null}
			<nav id="test-navigation" aria-label="Tests" {...stylex.props(styles.navigation)}>
				{[...groups].map(([name, tests]) => (
					<section key={name} aria-label={`${name} tests`} {...stylex.props(styles.navSection)}>
						<div {...stylex.props(styles.groupHeader)}>
							<strong {...stylex.props(styles.groupLabel)}>{name}</strong>
							<div {...stylex.props(styles.groupHeaderActions)}>
								<span {...stylex.props(styles.groupCount)}>{tests.length}</span>
								<RunTestGroupButton name={name} tests={tests} />
							</div>
						</div>
						{tests.map((test) => (
							<TestLink key={test.id} test={test} status={statuses.get(test.id)} />
						))}
					</section>
				))}
			</nav>
		</>
	);
}
function RunTestGroupButton({ name, tests }: { name: string; tests: TestRecord[] }) {
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
function TestLink({ test, status }: { test: TestRecord; status?: TestStatusValue }) {
	return (
		<Link
			to="/tests/$testId"
			params={{ testId: test.id }}
			search={{}}
			{...stylex.props(styles.navLink)}
			activeProps={stylex.props(styles.navLink, styles.active)}
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
function TestCatalogPage() {
	return (
		<section {...stylex.props(styles.hero)}>
			<div {...stylex.props(styles.brand)}>Test explorer</div>
			<h2 {...stylex.props(styles.title)}>Choose a test from the sidebar</h2>
			<p {...stylex.props(styles.description)}>
				Read what it checks, see its agents and judges, then start a run or inspect a saved
				execution.
			</p>
		</section>
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
	const selected = execution ?? preferredExecutionId(runs);
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
			<TestTabs active={activeView} onChange={chooseView} />
			<TestViewPanel
				view={activeView}
				test={test}
				runs={runs}
				selected={selected}
				onChooseExecution={chooseExecution}
			/>
		</>
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
				<CurrentRun test={props.test} executionId={props.selected} />
			) : null}
			{props.view === "history" ? (
				<RunHistory runs={props.runs} onChoose={props.onChooseExecution} />
			) : null}
		</div>
	);
}

function CurrentRun({ test, executionId }: { test: TestRecord; executionId?: string }) {
	return (
		<section {...stylex.props(styles.tabSection)}>
			{executionId ? (
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
	onChoose,
}: {
	runs: ExecutionSummary[];
	onChoose: (id: string) => void;
}) {
	return (
		<section {...stylex.props(styles.tabSection)}>
			<div {...stylex.props(styles.quietHeader)}>
				<span {...stylex.props(styles.resourceCount)}>{runs.length} executions</span>
			</div>
			{runs.length ? (
				<div {...stylex.props(styles.historyList)}>
					{runs.map((run) => (
						<HistoryItem key={run.id} run={run} onChoose={onChoose} />
					))}
				</div>
			) : (
				<p {...stylex.props(styles.empty)}>No saved runs for this test.</p>
			)}
		</section>
	);
}

function HistoryItem({ run, onChoose }: { run: ExecutionSummary; onChoose: (id: string) => void }) {
	return (
		<button
			type="button"
			aria-label={`Open ${run.status} execution ${run.id.slice(0, 8)}`}
			{...stylex.props(styles.buttonReset, styles.historyButton)}
			onClick={() => onChoose(run.id)}
		>
			<span {...stylex.props(styles.historyIdentity)}>
				<span {...stylex.props(styles.historyDate)}>
					{new Date(run.startedAt).toLocaleString()}
				</span>
				<span {...stylex.props(styles.historyId)}>{run.id.slice(0, 8)}</span>
			</span>
			<span
				{...stylex.props(
					styles.status,
					run.status === "passed" && styles.statusPass,
					run.status === "failed" && styles.statusFail,
					run.status === "running" && styles.statusRunning,
				)}
			>
				{run.status}
			</span>
		</button>
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
			{criteria.length ? (
				<ul {...stylex.props(styles.criteriaList)}>
					{criteria.map((criterion) => (
						<li key={criterion} {...stylex.props(styles.criterion)}>
							<span aria-hidden="true" {...stylex.props(styles.criterionIcon)}>
								✓
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
				<p {...stylex.props(styles.meta)}>Starting files and execution target for this test.</p>
			</div>
			<div {...stylex.props(styles.workspaceRow)}>
				<ResourceFact label="Source folder" value={test.workspace ?? "Project directory"} />
				<ResourceFact label="Project" value={test.project} />
				<ResourceFact label="Test file" value={test.file} />
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
	return (
		<ExecutionDetailView execution={{ ...detail.data, attempts }} criteria={testCriteria(test)} />
	);
}

function ExecutionPage() {
	const { executionId } = executionRoute.useParams();
	const detail = useQuery({
		queryKey: ["execution", executionId],
		queryFn: () => fetchExecution(executionId),
	});
	if (detail.isLoading) return <p {...stylex.props(styles.empty)}>Loading execution…</p>;
	if (detail.isError || !detail.data)
		return <p {...stylex.props(styles.empty)}>Execution is unavailable.</p>;
	return <ExecutionDetailView execution={detail.data} />;
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
					<AttemptCard key={attempt.id} attempt={attempt} criteria={criteria} />
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

function AttemptCard({ attempt, criteria = [] }: { attempt: Attempt; criteria?: string[] }) {
	const output = [...attempt.output.stdout, ...attempt.output.stderr].join("\n");
	const result = operationResult(attempt.operations);
	const title = attempt.title.filter(Boolean).at(-1) ?? "Unnamed test";
	const [selectedConversationId, setSelectedConversationId] = useState(attempt.operations[0]?.id);
	const selectedConversation =
		attempt.operations.find((operation) => operation.id === selectedConversationId) ??
		attempt.operations[0];
	return (
		<article {...stylex.props(styles.attemptCard)}>
			<div {...stylex.props(styles.row)}>
				<div>
					<strong {...stylex.props(styles.attemptTitle)}>{title}</strong>
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
			<OperationList operations={attempt.operations} />
			<RunResult
				result={result}
				status={attempt.status}
				criteria={criteria}
				explanations={judgeCriterionExplanations(attempt.operations)}
				errors={attempt.errors}
				criterionResults={attempt.criterionResults}
			/>
			{attempt.operations.length > 0 ? (
				<ConversationTabs
					operations={attempt.operations}
					selected={selectedConversation}
					select={setSelectedConversationId}
					attemptStatus={attempt.status}
				/>
			) : null}
			<Conversation
				operation={selectedConversation}
				operations={attempt.operations}
				select={setSelectedConversationId}
				status={
					attempt.status === "running"
						? (selectedConversation?.status ?? attempt.status)
						: attempt.status
				}
			/>
			<TechnicalDetails operations={attempt.operations} output={output} />
		</article>
	);
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

function RunResult({
	result,
	status,
	criteria,
	explanations,
	errors,
	criterionResults,
}: {
	result: RunResultData;
	status: string;
	criteria: string[];
	explanations: Array<string | undefined>;
	errors: Attempt["errors"];
	criterionResults: Attempt["criterionResults"];
}) {
	const presentations = criterionPresentations({
		criteria,
		explanations,
		results: criterionResults,
		status,
		errors,
	});
	const assignedFailures = new Set(presentations.map((item) => item.failure).filter(Boolean));
	return (
		<section aria-label="Result" {...stylex.props(styles.resultPanel)}>
			<h3 {...stylex.props(styles.contentHeading)}>Result</h3>
			<ResultVerdict status={status} />
			<CriterionResults presentations={presentations} />
			{errors
				.filter((error) => !assignedFailures.has(error.message))
				.map((error, index) => (
					<FailureDetails key={index} message={error.message ?? "Test failed"} />
				))}
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

function ResultVerdict({ status }: { status: string }) {
	return status === "running" ? (
		<p {...stylex.props(styles.resultOutput)}>The test is still running.</p>
	) : null;
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

function CriterionResults({ presentations }: { presentations: CriterionPresentation[] }) {
	if (!presentations.length) return null;
	return (
		<section aria-label="Criterion results" {...stylex.props(styles.criterionResults)}>
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

function Conversation({
	operation,
	operations,
	select,
	status,
}: {
	operation?: Attempt["operations"][number];
	operations: Attempt["operations"];
	select: (id: string) => void;
	status: string;
}) {
	const { timeline, judge } = conversationContent(operation, operations);
	return (
		<section aria-label="Conversation" {...stylex.props(styles.conversation)}>
			<header {...stylex.props(styles.conversationHeader)}>
				<h3 {...stylex.props(styles.contentHeading)}>Conversation</h3>
				<ConversationRunTabs operation={operation} operations={operations} select={select} />
			</header>
			<div {...stylex.props(styles.conversationThread)}>
				<ConversationEvents timeline={timeline} />
				<JudgeResponse review={judge} />
			</div>
			{timeline.length === 0 && status !== "running" ? (
				<p {...stylex.props(styles.meta)}>{conversationPlaceholder(status)}</p>
			) : null}
			{status === "running" ? <RunningIndicator kind={operation?.kind} /> : null}
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
	outcomes: Array<{ label: string; passed: boolean; explanation?: string }>;
	reason?: string;
};

function JudgeResponse({ review }: { review?: JudgeReviewData }) {
	if (!review || (!review.outcomes.length && !review.reason)) return null;
	return <JudgeFindings outcomes={review.outcomes} reason={review.reason} />;
}

function JudgeFindings({
	outcomes,
	reason,
}: {
	outcomes: JudgeReviewData["outcomes"];
	reason?: string;
}) {
	return (
		<section aria-label="Judge response" {...stylex.props(styles.judgeResponse)}>
			<h4 {...stylex.props(styles.judgeResponseHeading)}>Judge response</h4>
			<div {...stylex.props(styles.judgeOutcomeList)}>
				{outcomes.map((outcome) => (
					<div key={outcome.label} {...stylex.props(styles.judgeOutcome)}>
						<CriterionOutcomeIcon
							outcome={outcome.passed ? "passed" : "failed"}
							label={outcome.passed ? "Passed" : "Failed"}
						/>
						<span {...stylex.props(styles.judgeOutcomeLabel)}>{outcome.label}</span>
						{outcome.explanation ? (
							<p {...stylex.props(styles.judgeOutcomeExplanation)}>{outcome.explanation}</p>
						) : null}
					</div>
				))}
			</div>
			{reason && !outcomes.length ? (
				<p {...stylex.props(styles.judgeOutcomeExplanation)}>{reason}</p>
			) : null}
		</section>
	);
}

function judgeReviewData(operation: Attempt["operations"][number]): JudgeReviewData {
	const records = operation.data.filter(isRecord);
	const record = [...records].reverse().find((item) => item.output !== undefined) ?? records.at(-1);
	const output = isRecord(record?.output) ? record.output : {};
	const reason = optionalString(output.reason) ?? conversationOutput(record?.output);
	return {
		question: judgeQuestion(record),
		outcomes: judgeOutcomes(output, reason),
		reason,
	};
}

function judgeQuestion(record: Record<string, unknown> | undefined): string | undefined {
	const evaluation = isRecord(record?.evaluation) ? record.evaluation : undefined;
	return optionalString(evaluation?.prompt);
}

function judgeOutcomes(
	output: Record<string, unknown>,
	fallbackExplanation?: string,
): JudgeReviewData["outcomes"] {
	const entries = Object.entries(output).filter(
		(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
	);
	const fallbacks = splitJudgeExplanation(fallbackExplanation, entries.length);
	return entries.map(([key, passed], index) => ({
		label: humanizeKey(key),
		passed,
		explanation: judgeOutcomeExplanation(output, key) ?? fallbacks[index],
	}));
}

function splitJudgeExplanation(value: string | undefined, count: number): string[] {
	if (!value || count < 1) return [];
	const sentences = value.split(SENTENCE_BOUNDARY).filter(Boolean);
	if (sentences.length < count) return Array.from({ length: count }, () => value);
	return Array.from({ length: count }, (_, index) =>
		index === count - 1 ? sentences.slice(index).join(" ") : (sentences[index] ?? value),
	);
}

function judgeOutcomeExplanation(output: Record<string, unknown>, key: string): string | undefined {
	const explanations = isRecord(output.explanations) ? output.explanations : {};
	return (
		optionalString(explanations[key]) ??
		optionalString(output[`${key}Explanation`]) ??
		optionalString(output[`${key}Reason`])
	);
}

function judgeCriterionExplanations(operations: Attempt["operations"]): Array<string | undefined> {
	return operations
		.flatMap((operation) =>
			operation.kind === "evaluation" ? judgeReviewData(operation).outcomes : [],
		)
		.map((outcome) => outcome.explanation);
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
	operations,
	selected,
	select,
	attemptStatus,
}: {
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
			aria-label="Conversation participants"
			{...stylex.props(styles.conversationSwitcher, styles.conversationTabs)}
		>
			{groups.map((group, index) => (
				<ConversationTab
					key={group.key}
					operation={group.operations[0]}
					active={group.key === selectedGroup}
					running={
						attemptStatus === "running" &&
						group.operations.some((operation) => operation.status === "running")
					}
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
	running,
	onSelect,
	onKeyDown,
}: {
	operation?: Attempt["operations"][number];
	active: boolean;
	running: boolean;
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
				styles.status,
				styles.conversationTab,
				active && styles.conversationTabActive,
			)}
			onClick={onSelect}
			onKeyDown={onKeyDown}
		>
			{running ? (
				<span
					role="status"
					aria-label={`${operation?.name ?? "Agent"} is running`}
					{...stylex.props(styles.conversationTabDot)}
				/>
			) : null}
			{conversationLabel(operation)}
		</button>
	);
}

function conversationLabel(operation?: Attempt["operations"][number]): string {
	return `${operation?.name ?? "Unnamed"} · ${operation?.kind === "evaluation" ? "Judge" : "Agent"}`;
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
					<span {...stylex.props(styles.toolDetail)}>{presentation.detail}</span>
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
		return { icon: ">", title: "Run command", detail: argument(tool, "command"), outcome, failed };
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
		<div {...stylex.props(styles.list)}>
			{summaries.map((summary) => (
				<div key={summary.key} {...stylex.props(styles.meta)}>
					{summary.name} · {summary.status}
					{summary.count > 1 ? ` ×${summary.count}` : ""}
				</div>
			))}
		</div>
	);
}

function summarizeOperations(operations: Attempt["operations"]): Array<{
	key: string;
	name: string;
	status: string;
	count: number;
}> {
	const summaries = new Map<string, { key: string; name: string; status: string; count: number }>();
	for (const operation of operations) {
		const name = operation.name ?? operation.kind;
		const key = `${operationIdentity(operation)}\u0000${operation.status}`;
		const existing = summaries.get(key);
		if (existing) existing.count++;
		else summaries.set(key, { key, name, status: operation.status, count: 1 });
	}
	return [...summaries.values()];
}

function useExecutionHistory() {
	return useQuery({
		queryKey: ["execution-history"],
		queryFn: fetchExecutionHistory,
	});
}
async function fetchTestCatalog(): Promise<TestCatalog> {
	return viewerApi.getTestCatalog();
}
async function fetchExecutionHistory(): Promise<ExecutionSummary[]> {
	return (await viewerApi.listExecutions<{ executions: ExecutionSummary[] }>()).executions;
}
async function fetchExecution(id: string): Promise<ExecutionDetail> {
	return (await viewerApi.getExecution<{ execution: ExecutionDetail }>(id)).execution;
}
async function startTest(testId: string, workers: number): Promise<{ executionId: string }> {
	return viewerApi.startExecution(testId, workers);
}
async function startSuite(workers: number): Promise<{ executionId: string }> {
	return viewerApi.startSuiteExecution(workers);
}
async function startTestGroup(
	testIds: string[],
	workers: number,
): Promise<{ executionId: string }> {
	return viewerApi.startTestGroup(testIds, workers);
}
async function cancelExecution(id: string): Promise<void> {
	await viewerApi.cancelExecution(id);
}

function latestTestStatuses(executions: ExecutionSummary[]) {
	const statuses = new Map<string, TestStatusValue>();
	for (const execution of executions) {
		for (const testId of execution.testIds ?? []) {
			if (statuses.has(testId)) continue;
			statuses.set(testId, execution.testStatuses?.[testId] ?? execution.status);
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
