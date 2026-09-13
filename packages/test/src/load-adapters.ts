import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type HostAdapter, registerHostAdapter } from "@post-print/agent-harness";

const CONFIG_NAMES = [
	"agent-test.config.mjs",
	"agent-test.config.js",
	"agent-test.config.cjs",
	"agent-test.config.ts",
] as const;

export function defineConfig(config: { adapters?: HostAdapter[] }): { adapters?: HostAdapter[] } {
	return config;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function adaptersFromModule(mod: unknown): HostAdapter[] {
	if (!mod || typeof mod !== "object") {
		return [];
	}
	const record = mod as { default?: unknown; adapters?: unknown };
	const bag =
		record.default && typeof record.default === "object" ? (record.default as object) : record;
	const list = (bag as { adapters?: unknown }).adapters;
	if (!Array.isArray(list)) {
		return [];
	}
	return list.filter((item): item is HostAdapter => {
		return (
			typeof item === "object" &&
			item !== null &&
			typeof (item as HostAdapter).host === "string" &&
			typeof (item as HostAdapter).run === "function"
		);
	});
}

async function importAdapterModule(path: string): Promise<void> {
	let mod: unknown;
	try {
		mod = await import(pathToFileURL(path).href);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load host adapter module ${path}: ${message}`);
	}
	for (const adapter of adaptersFromModule(mod)) {
		registerHostAdapter(adapter);
	}
}

export async function resolveAdapterConfigPath(cwd: string): Promise<string | undefined> {
	for (const name of CONFIG_NAMES) {
		const candidate = resolve(cwd, name);
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

/** Load `--adapter` modules and `agent-test.config.*` from cwd. Side-effect registration is enough. */
export async function loadHostAdapters(options: {
	cwd: string;
	adapterModules?: readonly string[];
}): Promise<void> {
	for (const spec of options.adapterModules ?? []) {
		const path = resolve(options.cwd, spec);
		if (!(await pathExists(path))) {
			throw new Error(`Adapter module not found: ${path}`);
		}
		await importAdapterModule(path);
	}
	const configPath = await resolveAdapterConfigPath(options.cwd);
	if (configPath) {
		await importAdapterModule(configPath);
	}
}
