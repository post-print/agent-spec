import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

export type TestResource = {
	name: string;
	kind: "agent" | "judge";
	description?: string;
	host?: string;
	model?: string;
	skills: string[];
	mcpServers: string[];
	workspace?: string;
	prompt?: string;
};

/** A single runnable Playwright test as discovered from a TypeScript suite. */
export type DiscoveredTest = {
	id: string;
	file: string;
	title: string[];
	project: string;
	description?: string;
	criteria?: string[];
	resources?: TestResource[];
	workspace?: string;
};

/** The test browser's source of truth. Projects are execution targets, not agents. */
export type TestCatalog = {
	version: 1;
	generatedAt: string;
	config: string;
	projects: string[];
	tests: DiscoveredTest[];
	fingerprint: string;
};

export type PlaywrightTestEntry = {
	id: string;
	title: string;
	file: string;
	project: string;
	description?: string;
	criteria?: string[];
	resources?: TestResource[];
	workspace?: string;
};

export function createTestCatalog(config: string, entries: PlaywrightTestEntry[]): TestCatalog {
	const root = resolve(config, "..");
	const tests = entries.map((entry) => ({
		id: entry.id,
		file: relative(root, entry.file),
		title: entry.title.split(" › "),
		project: entry.project,
		description: entry.description,
		criteria: entry.criteria,
		resources: entry.resources,
		workspace: entry.workspace,
	}));
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		config,
		projects: [...new Set(tests.map((test) => test.project))].sort(),
		tests,
		fingerprint: catalogFingerprint(tests),
	};
}

function catalogFingerprint(tests: DiscoveredTest[]): string {
	return createHash("sha256").update(JSON.stringify(tests)).digest("hex").slice(0, 16);
}
