import { expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storedValue } from "../sdk/stored-value.js";
import { prepareAgent } from "../sdk/workspace.js";

it("stored values keep tool images intact even when base64 looks like a private path", () => {
	const image = { mediaType: "image/png", bytes: 12, data: "iVBOR/tmp/abc+def/Users/xyz==" };
	const call = { name: "Read", result: "[image: image/png, 1 KB]", images: [image] };
	expect(storedValue(call)).toEqual(call);
	expect(storedValue({ mediaType: "text/plain", bytes: 1, data: "/tmp/x/y" })).toEqual({
		mediaType: "text/plain",
		bytes: 1,
		data: "<local-path>/y",
	});
});

it("starting context rejects binary files instead of inlining garbled text", async () => {
	const directory = await mkdtemp(join(tmpdir(), "agent-test-context-image-"));
	try {
		await writeFile(join(directory, "notes.md"), "Owner: Ada\n");
		await writeFile(join(directory, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
		const agent = (files: string[]) => ({
			host: "claude" as const,
			options: { context: { files } },
		});
		const text = await prepareAgent(agent(["notes.md"]), directory, directory);
		expect(text.files).toEqual([{ path: "notes.md", content: "Owner: Ada\n" }]);
		await expect(prepareAgent(agent(["logo.png"]), directory, directory)).rejects.toThrow(
			"Context file logo.png is not UTF-8 text",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
