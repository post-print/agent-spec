import { access } from "node:fs/promises";
import { resolve } from "node:path";

/** Fail fast when a direct agent run cannot find suite definitions. */
export async function assertDirectAgentPreflight(
	repoRoot: string,
	suitesDir = "agent-suites",
): Promise<void> {
	const suitesRoot = resolve(repoRoot, suitesDir);
	try {
		await access(suitesRoot);
	} catch {
		throw new Error(
			[
				`Direct agent testing requires a suites directory (missing ${suitesRoot}).`,
				"Pass --suites-dir <path> or create agent-suites/<suite>/scenarios.json in the repo.",
				"See @post-print/agent-test README § Direct agent runs.",
			].join("\n"),
		);
	}
}
