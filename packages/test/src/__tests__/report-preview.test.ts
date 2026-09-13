import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listenReportPreview, shouldStartReportPreview } from "../report-preview.js";

describe("shouldStartReportPreview", () => {
	it("starts on a TTY outside CI", () => {
		expect(shouldStartReportPreview({}, true)).toBe(true);
	});

	it("skips CI, explicit opt-out, and non-TTY stdout", () => {
		expect(shouldStartReportPreview({ CI: "1" }, true)).toBe(false);
		expect(shouldStartReportPreview({ AGENT_TEST_NO_REPORT_PREVIEW: "1" }, true)).toBe(false);
		expect(shouldStartReportPreview({}, false)).toBe(false);
	});
});

describe("listenReportPreview", () => {
	const handles: Array<{ close: () => Promise<void> }> = [];

	afterEach(async () => {
		await Promise.all(handles.splice(0).map((handle) => handle.close()));
	});

	it("serves the html file at / so a browser can open it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agent-test-preview-"));
		const file = join(dir, "report.html");
		await writeFile(file, "<html><title>agent-test report</title></html>", "utf8");
		const preview = await listenReportPreview(file);
		handles.push(preview);
		const response = await fetch(preview.url);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(await response.text()).toContain("agent-test report");
		const missing = await fetch(new URL("/other", preview.url));
		expect(missing.status).toBe(404);
	});
});
