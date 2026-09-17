import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";

test("pending work can be cancelled", async () => {
	await new Promise(() => undefined);
});

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
