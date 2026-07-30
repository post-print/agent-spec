import { access } from "node:fs/promises";
import { resolve } from "node:path";

/** Fail fast when live dogfood cannot find suite definitions. */
export async function assertLiveDogfoodPreflight(
	repoRoot: string,
	suitesDir = "agent-suites",
): Promise<void> {
	const suitesRoot = resolve(repoRoot, suitesDir);
	try {
		await access(suitesRoot);
	} catch {
		throw new Error(
			[
				`Live dogfood requires a suites directory (missing ${suitesRoot}).`,
				"Pass --suites-dir <path> or create agent-suites/<suite>/scenarios.json in the repo.",
				"See @post-print/agent-test README § Live dogfood.",
			].join("\n"),
		);
	}
}
