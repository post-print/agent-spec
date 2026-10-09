import { expect, it } from "bun:test";
import { toolResultFields } from "../capture.js";
import { buildTraceFromClaudeEvents } from "../claude-capture.js";
import { MAX_INLINE_IMAGE_BYTES } from "../tool-images.js";

const SMALL_PNG = Buffer.alloc(3_000, 1).toString("base64");
const LARGE_PNG = Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1, 1).toString("base64");

it("tool images › a Claude Read of a PNG keeps the image beside a short text marker", () => {
	const trace = buildTraceFromClaudeEvents([
		{
			type: "assistant",
			message: {
				role: "assistant",
				content: [
					{ type: "tool_use", id: "toolu_png", name: "Read", input: { file_path: "a.png" } },
				],
			},
		},
		{
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_png",
						content: [
							{
								type: "image",
								source: { type: "base64", media_type: "image/png", data: SMALL_PNG },
							},
						],
					},
				],
			},
		},
	]);
	const [call] = trace.toolCalls;
	expect(call?.result).toBe('["[image: image/png, 3 KB]"]');
	expect(call?.images).toEqual([{ mediaType: "image/png", bytes: 3_000, data: SMALL_PNG }]);
});

it("tool images › an oversized MCP screenshot keeps only its metadata", () => {
	const fields = toolResultFields({
		content: [
			{ type: "text", text: "Screenshot taken" },
			{ type: "image", mimeType: "image/jpeg", data: LARGE_PNG },
		],
	});
	expect(fields.result).toContain("Screenshot taken");
	expect(fields.result).toContain("[image omitted: image/jpeg, 256 KB]");
	expect(fields.result?.length).toBeLessThan(200);
	expect(fields.images).toEqual([{ mediaType: "image/jpeg", bytes: MAX_INLINE_IMAGE_BYTES + 1 }]);
});

it("tool images › results without images are unchanged", () => {
	expect(toolResultFields("ok")).toEqual({ result: "ok" });
	expect(toolResultFields({ type: "image", url: "https://example.test/a.png" })).toEqual({
		result: '{"type":"image","url":"https://example.test/a.png"}',
	});
	expect(toolResultFields(undefined)).toEqual({});
});
