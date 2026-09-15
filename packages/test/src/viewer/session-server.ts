import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliMain } from "../cli-entry.js";
import { loadHostAdapters } from "../load-adapters.js";
import type { DetachedViewerManifest } from "../report-preview.js";
import { REPORT_PREVIEW_IDLE_MS } from "../report-preview.js";
import { loadViewerCatalog } from "./catalog.js";
import type { ViewerRunRecord } from "./events.js";
import { listenViewer } from "./server.js";

export async function startViewerSessionServer(
	manifestPath: string,
	idleMs: number,
): Promise<string> {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as DetachedViewerManifest;
	await loadHostAdapters({ cwd: manifest.cwd, adapterModules: manifest.adapterModules });
	const catalog = await loadViewerCatalog({
		cwd: manifest.cwd,
		suitesDir: manifest.suitesDir,
		rubricsDir: manifest.rubricsDir,
	});
	const importedId = `run-imported-${Date.now()}`;
	const initialRun: ViewerRunRecord = {
		id: importedId,
		request: manifest.request ?? {},
		status: "completed",
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		reports: manifest.reports,
	};
	const handle = await listenViewer({
		...manifest,
		catalog,
		initialRuns: [initialRun],
		selectedRunId: importedId,
		idleMs,
		onClose: () => removeLaunchManifest(manifestPath),
	});
	const cleanup = async (): Promise<void> => {
		await handle.close().catch(() => undefined);
	};
	process.once("SIGINT", () => {
		void cleanup();
	});
	process.once("SIGTERM", () => {
		void cleanup();
	});
	return handle.url;
}

async function removeLaunchManifest(manifestPath: string): Promise<void> {
	const absolute = resolve(manifestPath);
	const directory = dirname(absolute);
	const isDedicatedDirectory =
		dirname(directory) === resolve(tmpdir()) &&
		basename(directory).startsWith("agent-test-viewer-");
	if (isDedicatedDirectory) {
		await rm(directory, { recursive: true, force: true });
		return;
	}
	await rm(absolute, { force: true });
}

const entry = fileURLToPath(import.meta.url);
if (isCliMain(process.argv[1], entry)) {
	const manifestPath = process.argv[2];
	if (!manifestPath) process.exit(1);
	const idleMs = Number(process.argv[3]);
	void startViewerSessionServer(
		resolve(manifestPath),
		Number.isFinite(idleMs) && idleMs > 0 ? idleMs : REPORT_PREVIEW_IDLE_MS,
	)
		.then((url) => {
			process.stdout.write(`${url}\n`);
		})
		.catch(() => {
			process.exit(1);
		});
}
