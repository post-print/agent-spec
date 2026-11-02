import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import { namedCheckFailed, reportedOutcomes } from "./check-outcomes.js";
import type { ComparisonSubject, SampleAnnotation, SampleOutcome } from "./claims.js";
import { planIsDecided } from "./pass-rate.js";
import { sampleOutcome } from "./verdict.js";

export const SAMPLE_ANNOTATION = "agent-test.sample";
export const NO_AGENT_ANNOTATION = "agent-test.no-agent";
/** A control's annotation; its description is the label of the check that must fail. */
export const CONTROL_ANNOTATION = "agent-test.control";

export interface SamplingDetails {
	/** Run this test n times and report a rate. Pass a plan from `samplingPlan` to decide on it. */
	samples?: number | { n: number; flagAt?: number };
	/** Run the same task for each named arm, in a shuffled order. The body receives the arm's name. */
	variants?: readonly string[];
	/** What differs between arms on purpose. Any other difference refuses the comparison. */
	subject?: ComparisonSubject;
}
export interface SampleRun {
	info: TestInfo;
	annotation: SampleAnnotation;
	runtime: { reportedInfrastructureFailure(): boolean };
}
export interface PlannedSample {
	title: string;
	annotation: SampleAnnotation;
}
/** A repeatable shuffle: every worker must register the same tests in the same order. */
function shuffled<T>(items: T[], seed: string): T[] {
	const keyed = items.map((item, index) => ({
		item,
		key: createHash("sha256").update(`${seed}:${index}`).digest("hex"),
	}));
	return keyed.sort((a, b) => a.key.localeCompare(b.key)).map(({ item }) => item);
}
/** Differs per execution, so arms are not always run in one order. Workers inherit the same id. */
function shuffleSeed(title: string): string {
	return `${title}:${process.env.AGENT_TEST_EXECUTION_ID ?? ""}`;
}
export function plannedSamples(title: string, details: SamplingDetails): PlannedSample[] {
	const { samples = 1, variants, subject } = details;
	const { n, flagAt } = typeof samples === "number" ? { n: samples, flagAt: undefined } : samples;
	if (!Number.isInteger(n) || n < 1) throw new Error("samples must be a positive whole number");
	if (variants && variants.length > 2)
		throw new Error(`variants compares two arms at a time; "${title}" names ${variants.length}`);
	const arms = variants?.length ? [...variants] : [undefined];
	const planned = arms.flatMap((variant) =>
		Array.from({ length: n }, (_, index) => ({
			title: `${title} [${variant ? `${variant} ` : ""}${index + 1}/${n}]`,
			annotation: { title, variant, arms: variants, flagAt, n, subject },
		})),
	);
	return shuffled(planned, shuffleSeed(title));
}
function ledgerPath(info: TestInfo, annotation: SampleAnnotation): string {
	const key = createHash("sha256")
		.update(JSON.stringify([info.project.name, annotation.title, annotation.variant]))
		.digest("hex");
	return join(info.project.outputDir, ".sample-ledger", `${key}.ndjson`);
}
/** Whether each sample failed, by its first verdict, however many times it was retried. */
async function ledgerEntries(path: string): Promise<boolean[]> {
	const content = await readFile(path, "utf8").catch(() => "");
	const firstVerdicts = new Map<string, string>();
	for (const line of content.split("\n")) {
		const [outcome = "", testId = ""] = line.split(" ");
		if ((outcome === "failed" || outcome === "passed") && !firstVerdicts.has(testId))
			firstVerdicts.set(testId, outcome);
	}
	return [...firstVerdicts.values()].map((outcome) => outcome === "failed");
}
/** True when the plan's decision is already fixed, so this sample would only spend tokens. */
export async function sampleIsUnneeded(info: TestInfo, annotation: SampleAnnotation) {
	if (annotation.flagAt === undefined) return false;
	const entries = await ledgerEntries(ledgerPath(info, annotation));
	return planIsDecided({
		flagAt: annotation.flagAt,
		n: annotation.n,
		failures: entries.filter(Boolean).length,
		ran: entries.length,
	});
}
/** A sample with no verdict is not a run the plan can decide on, so it does not bring a stop closer. */
async function recordSample({ info, annotation }: SampleRun, outcome: SampleOutcome) {
	if (annotation.flagAt === undefined) return;
	const path = ledgerPath(info, annotation);
	await mkdir(join(path, ".."), { recursive: true });
	await appendFile(path, `${outcome} ${info.testId}\n`);
}
function attemptStatus(info: TestInfo, errors: unknown[]) {
	if (info.expectedStatus === "skipped") return "skipped";
	return errors.length > 0 ? "failed" : "passed";
}
/** Thrown errors reach the verdict named as the runner names them once it records the attempt. */
function asRecordedError(error: unknown): { message: string } {
	const { name, message } = error as Error;
	return { message: `${name}: ${message}` };
}
/** A failed `expect` carries its matcher's result; any other thrown error does not. */
function isFailedCheck(error: unknown): boolean {
	return (error as { matcherResult?: unknown } | null)?.matcherResult !== undefined;
}
function namedCheckOf(info: TestInfo): { namedCheckFailed?: boolean } {
	const mustFail = info.annotations.find(({ type }) => type === CONTROL_ANNOTATION)?.description;
	if (mustFail === undefined) return {};
	return { namedCheckFailed: namedCheckFailed(mustFail, reportedOutcomes()) };
}
/**
 * Asks the verdict how it will read this attempt, so the plan's stop follows its decision. A control
 * whose only failure was soft reads as no verdict here, which runs a sample more and never clears.
 */
function outcomeOf({ info, runtime }: SampleRun, thrown: unknown[]): SampleOutcome {
	const errors = [...info.errors, ...thrown.map(asRecordedError)];
	const expectedFailure = info.expectedStatus === "failed";
	return sampleOutcome({
		retry: info.retry,
		status: attemptStatus(info, errors),
		expectedFailure,
		survivedControl: expectedFailure && errors.length === 0,
		// While the body runs, the test's own errors so far can only be soft checks that failed.
		checkFailed: info.errors.length > 0 || thrown.some(isFailedCheck),
		...namedCheckOf(info),
		timedOut: info.status === "timedOut",
		errors,
		operations: runtime.reportedInfrastructureFailure()
			? [{ data: [{ kind: "infrastructure" }] }]
			: [],
	});
}
export async function runRecordingSample(run: SampleRun, body: () => Promise<void>) {
	const thrown: unknown[] = [];
	try {
		await body();
	} catch (error) {
		thrown.push(error);
		throw error;
	} finally {
		await recordSample(run, outcomeOf(run, thrown));
	}
}
