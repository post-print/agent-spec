import { writeSync } from "node:fs";

import { encodeViewerEvent, type ViewerEvent } from "./events.js";

export const VIEWER_EVENTS_FD = 3;
export const VIEWER_EVENTS_FD_ENV = "AGENT_TEST_EVENTS_FD";

export function viewerEventsFd(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env[VIEWER_EVENTS_FD_ENV]?.trim();
	if (!raw) {
		return undefined;
	}
	const fd = Number(raw);
	return Number.isInteger(fd) && fd >= 3 ? fd : undefined;
}

/** Write one NDJSON event to the parent pipe. No-op when the fd is unset. */
export function emitViewerEvent(event: ViewerEvent, fd = viewerEventsFd()): void {
	if (fd === undefined) {
		return;
	}
	try {
		writeSync(fd, `${encodeViewerEvent(event)}\n`);
	} catch {
		// Parent closed the pipe.
	}
}
