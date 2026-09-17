import { expect, it } from "bun:test";
import { parseViewerClientMessage, VIEWER_PROTOCOL_VERSION } from "../viewer/protocol.js";

it("viewer protocol › accepts a hello envelope so the server can report protocol mismatches", () => {
	expect(
		parseViewerClientMessage({
			type: "hello",
			protocol: VIEWER_PROTOCOL_VERSION,
			subscriptions: ["catalog", "executions"],
		}),
	).toMatchObject({ type: "hello", cursors: {} });
	expect(
		parseViewerClientMessage({ type: "hello", protocol: 2, subscriptions: ["catalog"] }),
	).toMatchObject({
		protocol: 2,
	});
});
