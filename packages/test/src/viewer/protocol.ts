export {
	VIEWER_PROTOCOL_VERSION,
	type ViewerClientMessage,
	viewerClientMessage,
} from "./generated-contracts.js";

import {
	type VIEWER_PROTOCOL_VERSION,
	type ViewerClientMessage,
	viewerClientMessage,
} from "./generated-contracts.js";

export type ViewerServerMessage =
	| { type: "ready"; protocol: typeof VIEWER_PROTOCOL_VERSION }
	| { type: "catalog.snapshot"; catalog: unknown }
	| { type: "executions.snapshot"; executions: unknown[] }
	| { type: "execution.snapshot"; execution: unknown }
	| { type: "error"; code: "invalid_message" | "incompatible_protocol"; message: string };

export function parseViewerClientMessage(input: unknown): ViewerClientMessage {
	return viewerClientMessage.parse(input);
}
