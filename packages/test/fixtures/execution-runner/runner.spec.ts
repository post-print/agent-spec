import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { reportProgress } from "../../src/index.js";

test("pending work can be cancelled", async () => {
	await new Promise(() => undefined);
});

test("published progress survives cancellation", async ({ browserName: _browserName }, info) => {
	await reportProgress(info, { pair: 1, status: "passed" });
	await new Promise(() => undefined);
});

for (const lane of ["left", "right"]) {
	test(`publishes concurrent progress ${lane}`, async ({ browserName: _browserName }, info) => {
		await reportProgress(info, { lane });
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	});
}

test("records the failed criterion before later criteria are skipped", {
	annotation: {
		type: "agent-test.criteria",
		description: JSON.stringify(["The value matches.", "The file is read.", "The tool runs."]),
	},
}, () => {
	expect("received").toBe("expected");
	expect(true).toBe(true);
	expect(true).toBe(true);
});

test("keeps an attachment while another execution starts", async ({
	browserName: _browserName,
}, info) => {
	const path = info.outputPath("agent-runs/events.ndjson");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, '{"type":"complete"}\n');
	await new Promise((resolveWait) => setTimeout(resolveWait, 300));
	await info.attach("agent-events", { path, contentType: "application/x-ndjson" });
});
