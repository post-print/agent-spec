import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function discoverSuites(suitesDir: string): Promise<string[]> {
	const entries = await readdir(suitesDir, { withFileTypes: true });
	const paths: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const scenarioPath = join(suitesDir, entry.name, "scenarios.json");
		try {
			await access(scenarioPath);
			paths.push(scenarioPath);
		} catch {}
	}
	return paths;
}
