import type { Page } from "@playwright/test";

import type { ViewerCatalog } from "../../src/viewer/catalog.js";
import type { ViewerServerHandle } from "../../src/viewer/server.js";
import { listenViewer } from "../../src/viewer/server.js";
import { e2eCatalog } from "./catalog.js";
import {
	createGateBox,
	createScriptedRunner,
	type GateBox,
	type ScriptedStep,
} from "./scripted-runner.js";

export interface ViewerHarness {
	url: string;
	gates: GateBox;
	jobs: string[];
	close: () => Promise<void>;
}

export interface StartViewerOptions {
	catalog?: ViewerCatalog;
	scripts?: Record<string, ScriptedStep[]>;
	defaultSteps?: ScriptedStep[];
	workers?: number;
}

export async function startViewer(options: StartViewerOptions = {}): Promise<ViewerHarness> {
	const gates = createGateBox();
	const jobs: string[] = [];
	const handle: ViewerServerHandle = await listenViewer({
		catalog: options.catalog ?? e2eCatalog,
		cwd: process.cwd(),
		suitesDir: options.catalog?.suitesDir ?? e2eCatalog.suitesDir,
		workers: options.workers ?? 4,
		runner: createScriptedRunner({
			scripts: options.scripts,
			defaultSteps: options.defaultSteps,
			gates,
			onJob: (job) => {
				jobs.push(`${job.suite}::${job.scenario}::${job.host}::${job.arm ?? "_"}`);
			},
		}),
	});
	return {
		url: handle.url,
		gates,
		jobs,
		close: handle.close,
	};
}

export async function openViewer(
	page: Page,
	options: StartViewerOptions = {},
): Promise<ViewerHarness> {
	const viewer = await startViewer(options);
	await page.goto(viewer.url);
	return viewer;
}

export function cell(
	page: Page,
	{ suite, scenario, host }: { suite: string; scenario: string; host: string },
) {
	return page.locator(`[data-cell="${suite}::${scenario}::${host}"]`);
}

export function liveSlot(page: Page, suite: string, scenario: string) {
	return page.locator(`[data-live-slot="${suite}::${scenario}"]`);
}

export function liveRow(page: Page, suite: string, scenario: string) {
	return page.locator(`[data-live-row="${suite}::${scenario}"]`);
}

export function hostTab(
	page: Page,
	{ suite, scenario, host }: { suite: string; scenario: string; host: string },
) {
	return cell(page, { suite: suite, scenario: scenario, host: host });
}

export function runScenario(page: Page, suite: string, scenario: string) {
	return page.locator(`[data-scenario-card="${suite}::${scenario}"] button.run-cell`);
}

export function runCell(
	page: Page,
	{ suite, scenario, host }: { suite: string; scenario: string; host: string },
) {
	return page.locator(
		`[data-scenario-card="${suite}::${scenario}"] button.run-cell[data-host="${host}"]`,
	);
}

export function cellStatus(
	page: Page,
	{ suite, scenario, host }: { suite: string; scenario: string; host: string },
) {
	return cell(page, { suite: suite, scenario: scenario, host: host }).locator(".cell-status");
}

export function hostToggle(page: Page, host: string) {
	return page.locator(`[data-host-toggle][value="${host}"]`);
}
