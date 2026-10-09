import type { AgentToolImage } from "./types.js";

/** Largest decoded image kept inline on a tool call. Larger images keep only their metadata. */
export const MAX_INLINE_IMAGE_BYTES = 256 * 1024;
/** Images kept inline per tool call; later images keep only their metadata. */
export const MAX_INLINE_IMAGES_PER_TOOL_CALL = 4;
const MAX_RESULT_DEPTH = 8;

type ImageBlock = { mediaType: string; data: string };

/**
 * Split a host tool result into text and images. Image blocks become a short
 * `[image: …]` marker in the text so traces, assertions, and judges never carry base64.
 */
export function extractToolImages(result: unknown): { value: unknown; images: AgentToolImage[] } {
	const images: AgentToolImage[] = [];
	const value = replaceImageBlocks(result, images, 0);
	return { value, images };
}

function replaceImageBlocks(value: unknown, images: AgentToolImage[], depth: number): unknown {
	if (depth > MAX_RESULT_DEPTH || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((item) => replaceImageBlocks(item, images, depth + 1));
	const block = imageBlock(value as Record<string, unknown>);
	if (block) return imageMarker(keepImage(block, images));
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, replaceImageBlocks(item, images, depth + 1)]),
	);
}

/** Claude `{ source: { type: "base64" } }` and MCP `{ data, mimeType }` image content blocks. */
function imageBlock(record: Record<string, unknown>): ImageBlock | undefined {
	if (record.type !== "image") return undefined;
	const source = record.source as Record<string, unknown> | undefined;
	if (source?.type === "base64" && typeof source.data === "string")
		return { mediaType: String(source.media_type ?? "image/*"), data: source.data };
	if (typeof record.data === "string" && typeof record.mimeType === "string")
		return { mediaType: record.mimeType, data: record.data };
	return undefined;
}

function keepImage(block: ImageBlock, images: AgentToolImage[]): AgentToolImage {
	const bytes = decodedBase64Bytes(block.data);
	const inline =
		bytes <= MAX_INLINE_IMAGE_BYTES &&
		images.filter((image) => image.data).length < MAX_INLINE_IMAGES_PER_TOOL_CALL;
	const image: AgentToolImage = {
		mediaType: block.mediaType,
		bytes,
		...(inline ? { data: block.data } : {}),
	};
	images.push(image);
	return image;
}

function imageMarker(image: AgentToolImage): string {
	const size = `${Math.max(1, Math.round(image.bytes / 1024))} KB`;
	return image.data
		? `[image: ${image.mediaType}, ${size}]`
		: `[image omitted: ${image.mediaType}, ${size}]`;
}

function decodedBase64Bytes(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}
