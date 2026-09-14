import type { HostAuthMode } from "@post-print/agent-harness";

import { DEFAULT_VIEWER_WORKERS } from "../worker-pool.js";
import { loadViewerCatalog } from "./catalog.js";
import { listenViewer } from "./server.js";

export interface ViewerCliOptions {
	cwd: string;
	suitesDir: string;
	rubricsDir?: string;
	filter?: string;
	judge?: boolean;
	timeoutMs?: number;
	authMode?: HostAuthMode;
	adapterModules?: string[];
	viewerPort?: number;
	/** Parallel live agents. Default 4. */
	workers?: number;
}

/** Start the localhost suite viewer and wait until the process exits. */
export async function startViewerCli(options: ViewerCliOptions): Promise<number> {
	const catalog = await loadViewerCatalog({
		cwd: options.cwd,
		suitesDir: options.suitesDir,
		rubricsDir: options.rubricsDir,
	});
	if (options.filter) {
		catalog.suites = catalog.suites.filter((suite) => suite.name === options.filter);
	}
	const workers = options.workers ?? DEFAULT_VIEWER_WORKERS;
	const handle = await listenViewer({
		catalog,
		cwd: options.cwd,
		suitesDir: options.suitesDir,
		rubricsDir: options.rubricsDir,
		judge: options.judge,
		timeoutMs: options.timeoutMs,
		authMode: options.authMode,
		adapterModules: options.adapterModules,
		port: options.viewerPort,
		workers,
	});
	console.log(`Suite viewer: ${handle.url}`);
	console.log(`${workers} workers. Ctrl+C stops the viewer.`);
	await new Promise<void>((resolveClose) => {
		const stop = (): void => {
			void handle.close().finally(() => resolveClose());
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
	return 0;
}
