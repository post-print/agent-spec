import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestInfo } from "@playwright/test";
import type { ComparisonSubject, SampleAnnotation } from "./claims.js";
import { isInfrastructureFailure } from "./failure.js";
import { planIsDecided } from "./pass-rate.js";

export const SAMPLE_ANNOTATION = "agent-test.sample";

export interface SamplingDetails {
	/** Run this test n times and report a rate. Pass a plan from `samplingPlan` to decide on it. */
	samples?: number | { n: number; flagAt?: number };
	/** Run the same task for each named arm, in a shuffled order. The body receives the arm's name. */
	variants?: readonly string[];
	/** What differs between arms on purpose. Any other difference refuses the comparison. */
	subject?: ComparisonSubject;
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
export function plannedSamples(title: string, details: SamplingDetails): PlannedSample[] {
	const { samples = 1, variants, subject } = details;
	const { n, flagAt } = typeof samples === "number" ? { n: samples, flagAt: undefined } : samples;
	if (!Number.isInteger(n) || n < 1) throw new Error("samples must be a positive whole number");
	const arms = variants?.length ? [...variants] : [undefined];
	const planned = arms.flatMap((variant) =>
		Array.from({ length: n }, (_, index) => ({
			title: `${title} [${variant ? `${variant} ` : ""}${index + 1}/${n}]`,
			annotation: { title, variant, flagAt, n, subject },
		})),
	);
	return shuffled(planned, title);
}
function ledgerPath(info: TestInfo, annotation: SampleAnnotation): string {
	const key = createHash("sha256")
		.update(JSON.stringify([info.project.name, annotation.title, annotation.variant]))
		.digest("hex");
	return join(info.project.outputDir, ".sample-ledger", `${key}.ndjson`);
}
async function ledgerEntries(path: string): Promise<boolean[]> {
	const content = await readFile(path, "utf8").catch(() => "");
	return content
		.split("\n")
		.flatMap((line) => (line === "failed" || line === "passed" ? [line === "failed"] : []));
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
async function recordSample(
	info: TestInfo,
	annotation: SampleAnnotation,
	outcome: "passed" | "failed" | "no_verdict",
) {
	if (annotation.flagAt === undefined) return;
	const path = ledgerPath(info, annotation);
	await mkdir(join(path, ".."), { recursive: true });
	await appendFile(path, `${outcome}\n`);
}
export async function runRecordingSample(
	info: TestInfo,
	annotation: SampleAnnotation,
	body: () => Promise<void>,
) {
	try {
		await body();
	} catch (error) {
		await recordSample(info, annotation, isInfrastructureFailure(error) ? "no_verdict" : "failed");
		throw error;
	}
	await recordSample(info, annotation, "passed");
}
