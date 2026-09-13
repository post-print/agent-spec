import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliMain } from "./cli-entry.js";
import { listenReportPreview } from "./report-preview.js";

const entry = fileURLToPath(import.meta.url);

if (isCliMain(process.argv[1], entry)) {
	const filePath = process.argv[2];
	if (!filePath) {
		process.stderr.write("report preview needs an html file path\n");
		process.exit(1);
	}
	const idleMs = Number(process.argv[3]);
	void listenReportPreview(resolve(filePath), {
		idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : undefined,
	})
		.then(({ url }) => {
			process.stdout.write(`${url}\n`);
		})
		.catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exit(1);
		});
}
