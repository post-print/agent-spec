import { access } from "node:fs/promises";
import { join } from "node:path";

/** Fail fast when live dogfood cannot find suite definitions. */
export async function assertLiveDogfoodPreflight(
	repoRoot: string,
	suitesDir = "agent-suites",
): Promise<void> {
	const suitesRoot = join(repoRoot, suitesDir);
	try {
		await access(suitesRoot);
	} catch {
		throw new Error(
			[
				`Live dogfood requires a suites directory (missing ${suitesDir}).`,
				"Pass --suites-dir <path> or create agent-suites/<suite>/scenarios.json in the repo.",
				"See @agent-spec/test README § Live dogfood.",
			].join("\n"),
		);
	}
}
