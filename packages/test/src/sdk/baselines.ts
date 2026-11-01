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
export async function readBaselines(config: string): Promise<Record<string, BaselineRecord>> {
	const directory = baselineDirectory(config);
	const names = await readdir(directory).catch(() => []);
	const records = await Promise.all(
		names
			.filter((name) => name.endsWith(".json"))
			.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))),
	);
	return Object.fromEntries((records as BaselineRecord[]).map((record) => [record.claim, record]));
}
/** Saves each single-arm claim with a verdict. Returns the claims it saved. */
export async function saveBaselines(config: string, claims: ClaimResult[]): Promise<string[]> {
	const directory = baselineDirectory(config);
	await mkdir(directory, { recursive: true });
	const saved: string[] = [];
	for (const claim of claims) {
		const [arm] = claim.arms;
		if (!arm || claim.arms.length !== 1 || !arm.total || !claim.fingerprint) continue;
		const record: BaselineRecord = {
			claim: claim.claim,
			fingerprint: claim.fingerprint,
			passed: arm.passed,
			total: arm.total,
			at: new Date().toISOString(),
		};
		await writeFile(
			join(directory, baselineFile(claim.claim)),
			`${JSON.stringify(record, null, 2)}\n`,
		);
		saved.push(claim.claim);
	}
	return saved;
}
