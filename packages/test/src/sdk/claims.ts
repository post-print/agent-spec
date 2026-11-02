import {
	differenceInterval,
	exactInterval,
	lowerBound,
	type RateDifference,
	type RateInterval,
	regressedFrom,
} from "./pass-rate.js";

/** What differs between the arms of a comparison on purpose. Anything else refuses the comparison. */
export type ComparisonSubject = "prompt" | "skills" | "workspace" | "tools" | "model";
export interface SampleAnnotation {
	title: string;
	variant?: string;
	/** Every arm the test declared, so an arm that never ran cannot go unnoticed. */
	arms?: readonly string[];
	flagAt?: number;
	n: number;
	subject?: ComparisonSubject;
}
export type SampleOutcome = "passed" | "failed" | "no_verdict" | "not_run";
export interface ClaimSample {
	claim: string;
	sample?: SampleAnnotation;
	outcome: SampleOutcome;
	/** A control that must fail passed on some attempt of this sample. */
	survivedControl?: boolean;
	record?: Record<string, unknown>;
}
export interface ClaimArm {
	variant?: string;
	passed: number;
	failed: number;
	noVerdict: number;
	/** Runs with a verdict: passed plus failed. */
	total: number;
	interval: RateInterval;
	lowerBound: number;
}
export interface BaselineRecord {
	claim: string;
	fingerprint: string;
	passed: number;
	total: number;
	at: string;
}
export type BaselineComparison =
	| { status: "none" }
	| { status: "new_conditions" }
	| { status: "same_conditions"; regressed: boolean; passed: number; total: number };
export interface ClaimResult {
	claim: string;
	arms: ClaimArm[];
	/** The test asked to be sampled, rather than being repeated from the command line. */
	declared: boolean;
	flagAt?: number;
	/** The plan's decision: flagged, clear of the flag, or only measured. */
	decision: "flagged" | "clear" | "measured" | "no_verdict";
	/** Samples whose control passed. Any at all means the test cannot tell good from bad. */
	controlsSurvived: number;
	/** Absent when the conditions cannot be told apart later, so no baseline can apply. */
	fingerprint?: string;
	comparison?: RateDifference & { first: string; second: string };
	comparisonRefused?: string;
	/** The samples disagree on their plan, so no one plan can decide them. */
	planConflict?: boolean;
	baseline: BaselineComparison;
}

const SHARED_CONDITIONS = [
	"host",
	"binaryVersion",
	"authMode",
	"confinement",
	"network",
	"settingSources",
	"userConfig",
	"overridingEnv",
	"hashes.settings",
];
const SUBJECT_CONDITIONS: Record<string, ComparisonSubject> = {
	requestedModel: "model",
	observedModel: "model",
	"hashes.prompt": "prompt",
	"hashes.skills": "skills",
	"hashes.tools": "tools",
	"hashes.initialSnapshot": "workspace",
};
function recordField(record: Record<string, unknown>, field: string): unknown {
	return field
		.split(".")
		.reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], record);
}
function fieldsFor(subject?: ComparisonSubject): string[] {
	const free = Object.entries(SUBJECT_CONDITIONS)
		.filter(([, owner]) => owner !== subject)
		.map(([field]) => field);
	return [...SHARED_CONDITIONS, "hashes.suite", ...free];
}
function recordsOf(samples: ClaimSample[]): Record<string, unknown>[] {
	return samples.flatMap(({ record }) => (record ? [record] : []));
}
/** The first listed condition the records do not share. */
function differingField(records: Record<string, unknown>[], fields: string[]): string | undefined {
	const first = records[0];
	return fields.find((field) => {
		const expected = JSON.stringify(first && recordField(first, field));
		return records.some((record) => JSON.stringify(recordField(record, field)) !== expected);
	});
}
/** No fingerprint when nothing names the model, or the runs differ: a later run cannot be matched. */
function fingerprintOf(samples: ClaimSample[]): string | undefined {
	const records = recordsOf(samples);
	const first = records[0];
	if (!first || !(first.requestedModel || first.observedModel)) return undefined;
	const fields = fieldsFor();
	if (differingField(records, fields)) return undefined;
	return JSON.stringify(fields.map((field) => recordField(first, field)));
}
function armOf(variant: string | undefined, samples: ClaimSample[]): ClaimArm {
	const count = (outcome: SampleOutcome) => samples.filter((s) => s.outcome === outcome).length;
	const passed = count("passed");
	const failed = count("failed");
	const total = passed + failed;
	return {
		variant,
		passed,
		failed,
		noVerdict: count("no_verdict"),
		total,
		interval: exactInterval(passed, total),
		lowerBound: lowerBound(passed, total),
	};
}
/** Names what keeps the arms from being compared, so the comparison can be refused. */
function comparisonConflict(arms: ClaimArm[], samples: ClaimSample[], subject?: ComparisonSubject) {
	const empty = arms.find(({ total }) => total === 0);
	if (empty) return `arm ${empty.variant ?? "first"} has no run with a verdict`;
	const records = recordsOf(samples);
	if (records.length === 0) return "no run recorded its conditions";
	const field = differingField(records, fieldsFor(subject));
	return field && `${field} differs between runs`;
}
/** A plan clears only on passes: a sample with no verdict could still have been a failure. */
function decisionOf(arms: ClaimArm[], sample?: SampleAnnotation): ClaimResult["decision"] {
	const flagAt = sample?.flagAt;
	if (flagAt !== undefined && arms.some(({ failed }) => failed >= flagAt)) return "flagged";
	if (arms.some(({ total }) => total === 0)) return "no_verdict";
	if (sample?.flagAt === undefined || flagAt === undefined) return "measured";
	const { n } = sample;
	return arms.every(({ passed }) => n - passed < flagAt) ? "clear" : "no_verdict";
}
function compared(arms: ClaimArm[], samples: ClaimSample[], subject?: ComparisonSubject) {
	const [first, second] = arms;
	if (arms.length !== 2 || !first || !second) return {};
	const conflict = comparisonConflict(arms, samples, subject);
	if (conflict) return { comparisonRefused: conflict };
	return {
		comparison: {
			...differenceInterval(first, second),
			first: first.variant ?? "first",
			second: second.variant ?? "second",
		},
	};
}
function baselineComparison(
	arms: ClaimArm[],
	fingerprint: string | undefined,
	baseline?: BaselineRecord,
): BaselineComparison {
	const [arm] = arms;
	if (!baseline || !arm || arms.length !== 1) return { status: "none" };
	if (baseline.fingerprint !== fingerprint) return { status: "new_conditions" };
	return {
		status: "same_conditions",
		regressed: regressedFrom(baseline, arm),
		passed: baseline.passed,
		total: baseline.total,
	};
}
/** Every sample of one claim must carry the same plan, or which one decides depends on order. */
function plansDisagree(samples: ClaimSample[]): boolean {
	const plans = samples.map(({ sample }) =>
		JSON.stringify(sample && [sample.n, sample.flagAt, sample.subject, sample.arms]),
	);
	return new Set(plans).size > 1;
}
function claimOf(
	claim: string,
	samples: ClaimSample[],
	baselines: Record<string, BaselineRecord>,
): ClaimResult {
	const annotation = samples.find(({ sample }) => sample)?.sample;
	const variants = annotation?.arms ?? [...new Set(samples.map(({ sample }) => sample?.variant))];
	const arms = variants.map((variant) =>
		armOf(
			variant,
			samples.filter(({ sample }) => sample?.variant === variant),
		),
	);
	const fingerprint = fingerprintOf(samples);
	return {
		claim,
		arms,
		declared: annotation !== undefined,
		flagAt: annotation?.flagAt,
		decision: decisionOf(arms, annotation),
		controlsSurvived: samples.filter(({ survivedControl }) => survivedControl).length,
		fingerprint,
		...compared(arms, samples, annotation?.subject),
		...(plansDisagree(samples) ? { planConflict: true } : {}),
		baseline: baselineComparison(arms, fingerprint, baselines[claim]),
	};
}
/** One test's identity across samples and repeats: its project and titles, without the file line. */
export function claimKey(attempt: { title: string[]; sample?: { title: string } }): string {
	const titles = attempt.title.filter(Boolean);
	const path = attempt.sample ? [...titles.slice(0, -1), attempt.sample.title] : titles;
	return path.join(" › ");
}
/** A claim is every run of one test: declared samples, or repeats of the same title. */
export function buildClaims(
	samples: ClaimSample[],
	baselines: Record<string, BaselineRecord> = {},
): ClaimResult[] {
	const grouped = new Map<string, ClaimSample[]>();
	for (const sample of samples)
		grouped.set(sample.claim, [...(grouped.get(sample.claim) ?? []), sample]);
	return [...grouped].map(([claim, group]) => claimOf(claim, group, baselines));
}
function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}
function armLine(arm: ClaimArm): string {
	const label = arm.variant ? `${arm.variant}: ` : "";
	const unknown = arm.noVerdict ? `, ${arm.noVerdict} with no verdict` : "";
	return `${label}${arm.passed} of ${arm.total} (95% interval ${percent(arm.interval.low)} to ${percent(arm.interval.high)})${unknown}`;
}
function comparisonLine(claim: ClaimResult): string[] {
	if (claim.comparisonRefused) return [`not compared: ${claim.comparisonRefused}`];
	if (!claim.comparison) return [];
	const { first, second, difference, low, high, distinguishable } = claim.comparison;
	const reading = distinguishable ? "a real difference" : "no difference shown at this sample size";
	return [
		`${first} minus ${second}: ${percent(difference)} (95% interval ${percent(low)} to ${percent(high)}), ${reading}`,
	];
}
function baselineLine({ baseline }: ClaimResult): string[] {
	if (baseline.status === "new_conditions")
		return ["conditions changed or are unknown, so no baseline applies"];
	if (baseline.status !== "same_conditions") return [];
	const against = `baseline ${baseline.passed} of ${baseline.total}`;
	return [baseline.regressed ? `regressed from ${against}` : `consistent with ${against}`];
}
/** Plain lines for a person: a rate, its uncertainty, and what may be concluded. */
export function claimLines(claim: ClaimResult): string[] {
	const decision =
		claim.decision === "flagged"
			? [`flagged at ${claim.flagAt} failures`]
			: claim.decision === "clear"
				? [`clear of the flag at ${claim.flagAt} failures`]
				: [];
	const survived = claim.controlsSurvived
		? [`a control that must fail passed in ${claim.controlsSurvived} samples`]
		: [];
	return [
		claim.claim,
		...survived,
		...claim.arms.map(armLine),
		...comparisonLine(claim),
		...baselineLine(claim),
		...decision,
	];
}
