import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { VIEWER_PROTOCOL_VERSION } from "../viewer/generated-contracts.js";

it("viewer contracts › generated handshake version matches AsyncAPI", async () => {
	const source = fileURLToPath(new URL("../../contracts/viewer.asyncapi.json", import.meta.url));
	const contract = JSON.parse(await readFile(source, "utf8")) as {
		channels: {
			"/api/live": {
				messages: { hello: { payload: { properties: { protocol: { const: number } } } } };
			};
		};
	};
	expect(VIEWER_PROTOCOL_VERSION).toBe(
		contract.channels["/api/live"].messages.hello.payload.properties.protocol.const,
	);
});
