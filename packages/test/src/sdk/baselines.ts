import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BaselineRecord, ClaimResult } from "./claims.js";

/** Committed, because the execution store keeps only the newest fifty runs. */
export function baselineDirectory(config: string): string {
	return join(dirname(config), "agent-test-baselines");
}
function baselineFile(claim: string): string {
	return `${createHash("sha256").update(claim).digest("hex").slice(0, 16)}.json`;
}
function isBaselineRecord(value: unknown): value is BaselineRecord {
	const record = value as Partial<BaselineRecord> | null;
	return (
		typeof record?.claim === "string" &&
		typeof record.fingerprint === "string" &&
		Number.isInteger(record.passed) &&
		Number.isInteger(record.total)
	);
}
async function readBaseline(path: string): Promise<BaselineRecord | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return isBaselineRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
/** A file that cannot be read is named, not skipped: it may be the baseline a run would regress from. */
export async function readBaselines(config: string): Promise<{
	records: Record<string, BaselineRecord>;
	unreadable: string[];
}> {
	const directory = baselineDirectory(config);
	const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json"));
	const read = await Promise.all(names.map((name) => readBaseline(join(directory, name))));
	return {
		records: Object.fromEntries(read.flatMap((record) => (record ? [[record.claim, record]] : []))),
		unreadable: names.filter((_name, index) => !read[index]),
	};
}
/** Why a claim cannot serve as a baseline, if it cannot. */
function unfitForBaseline(claim: ClaimResult): string | undefined {
	const [arm] = claim.arms;
	if (!arm || claim.arms.length !== 1) return "it has more than one arm";
	if (!claim.fingerprint) return "its model or conditions are unknown or changed mid-run";
	if (claim.decision === "no_verdict" || arm.noVerdict > 0)
		return "some of its runs have no verdict";
	return claim.controlsSurvived > 0 ? "a control survived" : undefined;
}
export interface SavedBaselines {
	saved: string[];
	skipped: { claim: string; reason: string }[];
}
function baselineRecord(claim: ClaimResult): BaselineRecord {
	const [arm] = claim.arms;
	return {
		claim: claim.claim,
		fingerprint: claim.fingerprint ?? "",
		passed: arm?.passed ?? 0,
		total: arm?.total ?? 0,
		at: new Date().toISOString(),
	};
}
/** Saves each single-arm claim that earned its rate. Says why it left out the others. */
export async function saveBaselines(
	config: string,
	claims: ClaimResult[],
): Promise<SavedBaselines> {
	const directory = baselineDirectory(config);
	await mkdir(directory, { recursive: true });
	const result: SavedBaselines = { saved: [], skipped: [] };
	for (const claim of claims) {
		const reason = unfitForBaseline(claim);
		if (reason) {
			result.skipped.push({ claim: claim.claim, reason });
			continue;
		}
		await writeFile(
			join(directory, baselineFile(claim.claim)),
			`${JSON.stringify(baselineRecord(claim), null, 2)}\n`,
		);
		result.saved.push(claim.claim);
	}
	return result;
}
