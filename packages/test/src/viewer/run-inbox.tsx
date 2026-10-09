import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	formatRunDate,
	runStatusCounts,
	stripAnsi,
	type TestRunStatus,
	testIdsBySeverity,
	testRunStatus,
} from "./presentation.js";
import type { DiscoveredTest } from "./test-catalog.js";
import {
	cancelExecution,
	type ExecutionSummary,
	fetchExecution,
	useCatalog,
	useExecutionHistory,
} from "./viewer-queries.js";

type RunDetail = ExecutionSummary & {
	cancellable?: boolean;
	attempts: Array<{ testId?: string; errors: Array<{ message?: string }> }>;
};
type StatusFilter = TestRunStatus | "all";

const EARLIER_RUN_LIMIT = 20;
const STARTED_STATUSES = new Set<TestRunStatus>(["running", "passed", "failed"]);
const ERROR_EXCERPT_LENGTH = 180;

/** Home: the run that needs attention now, then earlier runs. */
export function RunInboxPage() {
	const history = useExecutionHistory();
	if (history.isPending) return <p {...stylex.props(styles.empty)}>Loading runs…</p>;
	if (history.isError) return <p role="alert">Run history is unavailable.</p>;
	const latest = history.data.find((run) => run.status === "running") ?? history.data[0];
	if (!latest) return <FirstRunInvitation />;
	return (
		<div {...stylex.props(styles.page)}>
			<RunOverview
				run={latest}
				eyebrow={latest.status === "running" ? "Running now" : "Latest run"}
			/>
			<EarlierRuns runs={history.data.filter((run) => run.id !== latest.id)} />
		</div>
	);
}

/** One saved or live run, addressed by id. Falls back to the record when history is trimmed. */
export function RunPage({ executionId }: { executionId: string }) {
	const history = useExecutionHistory();
	const summary = history.data?.find((run) => run.id === executionId);
	const record = useQuery({
		queryKey: ["execution", executionId],
		queryFn: () => fetchExecution<RunDetail>(executionId),
		enabled: !history.isPending && summary === undefined,
	});
	const run = summary ?? record.data;
	if (run) return <RunOverview run={run} eyebrow="Run" />;
	if (history.isPending || record.isPending)
		return <p {...stylex.props(styles.empty)}>Loading run…</p>;
	return <p role="alert">This run is unavailable. It may have been removed from history.</p>;
}

function RunOverview({ run, eyebrow }: { run: ExecutionSummary; eyebrow: string }) {
	const [filter, setFilter] = useState<StatusFilter>("all");
	const counts = runStatusCounts(run);
	const detail = useRunDetail(run, counts);
	const testIds = testIdsBySeverity(run).filter(
		(testId) => filter === "all" || testRunStatus(run, testId) === filter,
	);
	return (
		<section aria-labelledby={`run-${run.id}`} {...stylex.props(styles.page)}>
			<RunHeader run={run} eyebrow={eyebrow} detail={detail} />
			<StatusFilters
				total={run.testIds?.length ?? 0}
				counts={counts}
				active={filter}
				onChange={setFilter}
			/>
			<RunTestList run={run} testIds={testIds} detail={detail} />
		</section>
	);
}

/** Failure excerpts and the stop control need the full record; passing runs skip that fetch. */
function useRunDetail(run: ExecutionSummary, counts: Map<TestRunStatus, number>) {
	const needsDetail = run.status === "running" || counts.has("failed") || counts.has("interrupted");
	const detail = useQuery({
		queryKey: ["execution", run.id],
		queryFn: () => fetchExecution<RunDetail>(run.id),
		enabled: needsDetail,
	});
	return detail.data;
}

function RunHeader({
	run,
	eyebrow,
	detail,
}: {
	run: ExecutionSummary;
	eyebrow: string;
	detail?: RunDetail;
}) {
	const count = run.testIds?.length ?? 0;
	const duration = runDuration(run);
	return (
		<header {...stylex.props(styles.header)}>
			<div {...stylex.props(styles.headerCopy)}>
				<span {...stylex.props(styles.eyebrow)}>{eyebrow}</span>
				<h2 id={`run-${run.id}`} {...stylex.props(styles.title)}>
					{formatRunDate(run.startedAt)}
				</h2>
				<RunNotice run={run} />
				<p {...stylex.props(styles.meta)}>
					{count} {count === 1 ? "test" : "tests"}
					{duration ? ` · ${duration}` : ""} ·{" "}
					<span {...stylex.props(styles.mono)}>{run.id.slice(0, 8)}</span>
				</p>
			</div>
			<div {...stylex.props(styles.headerActions)}>
				{run.status === "running" && detail?.cancellable ? <StopRunButton run={run} /> : null}
				<StatusPill status={runOutcome(run)} />
			</div>
		</header>
	);
}

/** Explains a run that has no test outcome yet, or never got one. */
function RunNotice({ run }: { run: ExecutionSummary }) {
	const statuses = (run.testIds ?? []).map((testId) => testRunStatus(run, testId));
	if (statuses.some((status) => STARTED_STATUSES.has(status))) return null;
	const count = statuses.length;
	if (run.status === "running")
		return (
			<p role="status" {...stylex.props(styles.meta)}>
				{count ? `Starting ${count} ${count === 1 ? "test" : "tests"}…` : "Starting the test run…"}
			</p>
		);
	if (run.status === "interrupted")
		return <p {...stylex.props(styles.meta)}>Run stopped before the first test started.</p>;
	if (run.status === "failed")
		return <p {...stylex.props(styles.meta)}>Run failed before the first test started.</p>;
	return null;
}

function StopRunButton({ run }: { run: ExecutionSummary }) {
	const client = useQueryClient();
	const cancel = useMutation({
		mutationFn: () => cancelExecution(run.id),
		onSuccess: () => client.invalidateQueries({ queryKey: ["execution", run.id] }),
	});
	const stopping = cancel.isPending || cancel.isSuccess;
	return (
		<>
			<button
				type="button"
				{...stylex.props(styles.buttonReset, styles.secondaryButton)}
				onClick={() => cancel.mutate()}
				disabled={stopping}
			>
				{stopping
					? "Stopping…"
					: (run.testIds?.length ?? 0) > 1
						? "Stop suite run"
						: "Stop this run"}
			</button>
			{cancel.isError ? <p role="alert">The run could not be stopped.</p> : null}
		</>
	);
}

function StatusFilters({
	total,
	counts,
	active,
	onChange,
}: {
	total: number;
	counts: Map<TestRunStatus, number>;
	active: StatusFilter;
	onChange: (filter: StatusFilter) => void;
}) {
	const options: Array<[StatusFilter, number]> = [["all", total], ...counts];
	return (
		<fieldset {...stylex.props(styles.filters)}>
			<legend {...stylex.props(styles.visuallyHidden)}>Show tests by result</legend>
			{options.map(([status, count]) => (
				<button
					key={status}
					type="button"
					aria-pressed={active === status}
					{...stylex.props(
						styles.buttonReset,
						styles.filter,
						active === status && styles.filterActive,
					)}
					onClick={() => onChange(active === status ? "all" : status)}
				>
					{status !== "all" ? <StatusDot status={status} inline /> : null}
					<span>{status === "all" ? "All" : capitalize(status)}</span>
					<span {...stylex.props(styles.filterCount)}>{count}</span>
				</button>
			))}
		</fieldset>
	);
}

function RunTestList({
	run,
	testIds,
	detail,
}: {
	run: ExecutionSummary;
	testIds: string[];
	detail?: RunDetail;
}) {
	const catalog = useCatalog();
	const tests = new Map(catalog.data?.tests.map((test) => [test.id, test]));
	if (testIds.length === 0)
		return <p {...stylex.props(styles.empty)}>No tests match this result.</p>;
	return (
		<ol {...stylex.props(styles.testList)}>
			{testIds.map((testId) => (
				<li key={testId}>
					<RunTestRow
						runId={run.id}
						status={testRunStatus(run, testId)}
						test={tests.get(testId) ?? missingTest(testId)}
						error={firstErrorLine(detail, testId)}
					/>
				</li>
			))}
		</ol>
	);
}

function RunTestRow({
	runId,
	status,
	test,
	error,
}: {
	runId: string;
	status: TestRunStatus;
	test: DiscoveredTest;
	error?: string;
}) {
	const group = test.title.slice(0, -1).join(" › ");
	return (
		<Link
			to="/tests/$testId"
			params={{ testId: test.id }}
			search={{ execution: runId }}
			{...stylex.props(styles.testRow, status === "failed" && styles.testRowFailed)}
		>
			<StatusDot status={status} />
			<span {...stylex.props(styles.testCopy)}>
				<span {...stylex.props(styles.testTitle)}>{test.title.at(-1)}</span>
				{group ? <span {...stylex.props(styles.testGroup)}>{group}</span> : null}
				{error ? <span {...stylex.props(styles.testError)}>{error}</span> : null}
			</span>
			<span {...stylex.props(styles.rowStatus)}>{status}</span>
		</Link>
	);
}

function EarlierRuns({ runs }: { runs: ExecutionSummary[] }) {
	if (runs.length === 0) return null;
	return (
		<section aria-labelledby="earlier-runs" {...stylex.props(styles.earlier)}>
			<h3 id="earlier-runs" {...stylex.props(styles.sectionTitle)}>
				Earlier runs
			</h3>
			<ol {...stylex.props(styles.testList)}>
				{runs.slice(0, EARLIER_RUN_LIMIT).map((run) => (
					<li key={run.id}>
						<EarlierRunRow run={run} />
					</li>
				))}
			</ol>
		</section>
	);
}

/** A single-test run opens that test; a batch opens its own inbox. */
function EarlierRunRow({ run }: { run: ExecutionSummary }) {
	const catalog = useCatalog();
	const [onlyTestId, ...others] = run.testIds ?? [];
	const onlyTest =
		others.length === 0 ? catalog.data?.tests.find((test) => test.id === onlyTestId) : undefined;
	const when = formatRunDate(run.startedAt);
	const body = (
		<>
			<StatusDot status={runOutcome(run)} />
			<span {...stylex.props(styles.testCopy)}>
				<span {...stylex.props(styles.testTitle)}>{onlyTest?.title.at(-1) ?? when}</span>
				<span {...stylex.props(styles.testGroup)}>
					{onlyTest ? when : `${run.testIds?.length ?? 0} tests · ${countSummary(run)}`}
				</span>
			</span>
			<span {...stylex.props(styles.rowStatus)}>{runOutcome(run)}</span>
		</>
	);
	return onlyTest ? (
		<Link
			to="/tests/$testId"
			params={{ testId: onlyTest.id }}
			search={{ execution: run.id }}
			{...stylex.props(styles.testRow)}
		>
			{body}
		</Link>
	) : (
		<Link
			to="/executions/$executionId"
			params={{ executionId: run.id }}
			{...stylex.props(styles.testRow)}
		>
			{body}
		</Link>
	);
}

function FirstRunInvitation() {
	return (
		<section {...stylex.props(styles.header, styles.invitation)}>
			<span {...stylex.props(styles.eyebrow)}>Runs</span>
			<h2 {...stylex.props(styles.title)}>Run your first test</h2>
			<p {...stylex.props(styles.meta)}>
				Choose a test in the sidebar or select Run all tests. Runs started with{" "}
				<code {...stylex.props(styles.mono)}>agent-test test</code> also appear here while they
				stream.
			</p>
		</section>
	);
}

function StatusPill({ status }: { status: TestRunStatus }) {
	return (
		<span
			{...stylex.props(
				styles.pill,
				status === "passed" && styles.pillPass,
				status === "failed" && styles.pillFail,
				(status === "running" || status === "queued") && styles.pillRunning,
			)}
		>
			{status}
		</span>
	);
}

function StatusDot({ status, inline = false }: { status: TestRunStatus; inline?: boolean }) {
	return (
		<span
			aria-hidden="true"
			{...stylex.props(
				styles.dot,
				inline && styles.dotInline,
				status === "passed" && styles.dotPass,
				status === "failed" && styles.dotFail,
				(status === "running" || status === "queued") && styles.dotRunning,
				status === "skipped" && styles.dotSkipped,
			)}
		/>
	);
}

/** The most severe test outcome; a batch with nothing run is not "passed". */
function runOutcome(run: ExecutionSummary): TestRunStatus {
	if (run.status === "running") return "running";
	const worst = runStatusCounts(run).keys().next().value ?? "passed";
	if (run.status === "interrupted" && (worst === "passed" || worst === "skipped"))
		return "interrupted";
	return worst;
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function countSummary(run: ExecutionSummary): string {
	const parts = [...runStatusCounts(run)].map(([status, count]) => `${count} ${status}`);
	return parts.join(" · ") || "No tests recorded";
}

function runDuration(run: ExecutionSummary): string | undefined {
	if (!run.finishedAt) return undefined;
	const seconds = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
	if (!Number.isFinite(seconds) || seconds < 0) return undefined;
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function firstErrorLine(detail: RunDetail | undefined, testId: string): string | undefined {
	const message = detail?.attempts
		.filter((attempt) => attempt.testId === testId)
		.flatMap((attempt) => attempt.errors)
		.find((error) => error.message)?.message;
	const line = message
		? stripAnsi(message)
				.split("\n")
				.find((text) => text.trim())
		: undefined;
	return line && line.length > ERROR_EXCERPT_LENGTH
		? `${line.slice(0, ERROR_EXCERPT_LENGTH)}…`
		: line?.trim();
}

function missingTest(testId: string): DiscoveredTest {
	return { id: testId, title: ["Test no longer in the catalog"], file: "", project: "" };
}

const styles = stylex.create({
	page: { display: "grid", gap: "1rem" },
	buttonReset: { appearance: "none", font: "inherit", borderWidth: 0 },
	header: {
		display: "flex",
		flexWrap: "wrap",
		alignItems: "flex-start",
		justifyContent: "space-between",
		gap: "1rem",
		padding: { default: "1.1rem 1.25rem", "@media (max-width: 620px)": "1rem" },
		border: "1px solid var(--border)",
		borderRadius: 12,
		backgroundColor: "var(--panel)",
	},
	invitation: { display: "grid", justifyContent: "stretch" },
	headerCopy: { display: "grid", gap: "0.3rem", minWidth: 0 },
	headerActions: { display: "flex", alignItems: "center", gap: "0.6rem" },
	eyebrow: {
		color: "var(--accent)",
		fontSize: "0.66rem",
		fontWeight: 750,
		letterSpacing: "0.11em",
		textTransform: "uppercase",
	},
	title: {
		margin: 0,
		fontSize: { default: "clamp(1.08rem, 1.5vw, 1.3rem)", "@media (max-width: 620px)": "1.08rem" },
		lineHeight: 1.18,
		letterSpacing: "-0.025em",
		fontWeight: 720,
	},
	sectionTitle: { margin: 0, fontSize: "0.92rem", letterSpacing: "-0.01em" },
	meta: { color: "var(--muted)", fontSize: "0.82rem", lineHeight: 1.5 },
	mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em" },
	secondaryButton: {
		minHeight: "2.25rem",
		padding: "0.45rem 0.8rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: "var(--border-strong)",
		borderRadius: 9,
		backgroundColor: { default: "var(--panel-2)", ":hover": "var(--panel-3)" },
		color: "var(--text)",
		fontSize: "0.8rem",
		fontWeight: 650,
		cursor: "pointer",
	},
	filters: {
		display: "flex",
		flexWrap: "wrap",
		gap: "0.45rem",
		margin: 0,
		padding: 0,
		borderWidth: 0,
		minWidth: 0,
	},
	visuallyHidden: {
		position: "absolute",
		width: 1,
		height: 1,
		overflow: "hidden",
		clipPath: "inset(50%)",
		whiteSpace: "nowrap",
	},
	filter: {
		display: "inline-flex",
		alignItems: "center",
		gap: "0.4rem",
		minHeight: "2.25rem",
		padding: "0.35rem 0.75rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":hover": "var(--border-strong)" },
		borderRadius: 999,
		backgroundColor: "var(--panel)",
		color: "var(--muted)",
		fontSize: "0.78rem",
		fontWeight: 650,
		fontVariantNumeric: "tabular-nums",
		cursor: "pointer",
	},
	filterCount: { color: "var(--subtle)" },
	filterActive: {
		borderColor: "var(--accent)",
		backgroundColor: "var(--accent-soft)",
		color: "var(--text)",
	},
	testList: { display: "grid", gap: "0.4rem", margin: 0, padding: 0, listStyle: "none" },
	testRow: {
		display: "grid",
		gridTemplateColumns: "0.7rem minmax(0, 1fr) auto",
		alignItems: "start",
		gap: "0.75rem",
		padding: "0.7rem 0.9rem",
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":hover": "var(--border-strong)" },
		borderRadius: 10,
		backgroundColor: { default: "var(--panel)", ":hover": "var(--panel-2)" },
		color: "var(--text)",
		textDecoration: "none",
	},
	testRowFailed: {
		borderColor: { default: "oklch(0.73 0.18 25 / 0.45)", ":hover": "var(--fail)" },
	},
	testCopy: { display: "grid", gap: "0.2rem", minWidth: 0 },
	testTitle: { fontSize: "0.86rem", fontWeight: 600, lineHeight: 1.35 },
	testGroup: { color: "var(--subtle)", fontSize: "0.72rem" },
	testError: {
		color: "oklch(0.86 0.08 25)",
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
		fontSize: "0.72rem",
		lineHeight: 1.45,
		overflowWrap: "anywhere",
	},
	rowStatus: {
		color: "var(--muted)",
		fontSize: "0.68rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
	},
	earlier: { display: "grid", gap: "0.65rem", marginTop: "0.75rem" },
	pill: {
		fontSize: "0.68rem",
		fontWeight: 750,
		letterSpacing: "0.06em",
		textTransform: "uppercase",
		padding: "0.2rem 0.55rem",
		borderRadius: 999,
		border: "1px solid var(--border)",
		color: "var(--muted)",
	},
	pillPass: {
		color: "var(--pass)",
		borderColor: "var(--pass)",
		backgroundColor: "var(--pass-soft)",
	},
	pillFail: {
		color: "var(--fail)",
		borderColor: "var(--fail)",
		backgroundColor: "var(--fail-soft)",
	},
	pillRunning: {
		color: "var(--skip)",
		borderColor: "var(--skip)",
		backgroundColor: "var(--skip-soft)",
	},
	dot: {
		alignSelf: "start",
		marginTop: "0.38rem",
		width: 8,
		height: 8,
		borderRadius: 999,
		backgroundColor: "var(--muted)",
	},
	dotInline: { alignSelf: "center", marginTop: 0 },
	dotPass: { backgroundColor: "var(--pass)" },
	dotFail: { backgroundColor: "var(--fail)" },
	dotRunning: { backgroundColor: "var(--skip)", boxShadow: "0 0 0 3px var(--skip-soft)" },
	dotSkipped: {
		backgroundColor: "transparent",
		borderWidth: 1.5,
		borderStyle: "solid",
		borderColor: "var(--subtle)",
	},
	empty: { color: "var(--muted)", fontStyle: "italic", padding: "1rem 0" },
});
