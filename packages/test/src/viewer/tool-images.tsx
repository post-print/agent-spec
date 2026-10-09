import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

/** An image a tool returned, as the harness records it on `AgentToolCall.images`. */
export type ToolImage = { mediaType: string; bytes: number; data?: string };

const RENDERABLE_IMAGE = /^image\/(png|jpeg|gif|webp)$/;

export function toolImages(value: unknown): ToolImage[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const images = value.flatMap((item): ToolImage[] => {
		if (typeof item !== "object" || item === null) return [];
		const { mediaType, bytes, data } = item as Record<string, unknown>;
		if (typeof mediaType !== "string" || typeof bytes !== "number") return [];
		return [{ mediaType, bytes, ...(typeof data === "string" ? { data } : {}) }];
	});
	return images.length ? images : undefined;
}

/** Thumbnails beside a tool call. Selecting one enlarges it in place. */
export function ToolImages({ images, toolName }: { images: ToolImage[]; toolName: string }) {
	return (
		<ul aria-label={`Images returned by ${toolName}`} {...stylex.props(styles.list)}>
			{images.map((image, index) => (
				<li key={`${index}-${image.bytes}`}>
					{image.data && RENDERABLE_IMAGE.test(image.mediaType) ? (
						<ImageThumbnail image={image} data={image.data} label={imageLabel(image, toolName)} />
					) : (
						<span {...stylex.props(styles.omitted)}>
							{image.mediaType} · {formatBytes(image.bytes)} ·{" "}
							{image.data ? "not previewable" : "too large to store"}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

function ImageThumbnail({ image, data, label }: { image: ToolImage; data: string; label: string }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<button
			type="button"
			aria-pressed={expanded}
			aria-label={`${expanded ? "Shrink" : "Enlarge"} ${label}`}
			{...stylex.props(styles.thumbnailButton, expanded && styles.thumbnailButtonExpanded)}
			onClick={() => setExpanded((open) => !open)}
		>
			<img
				src={`data:${image.mediaType};base64,${data}`}
				alt={label}
				width={144}
				height={96}
				{...stylex.props(styles.image, expanded && styles.imageExpanded)}
			/>
		</button>
	);
}

function imageLabel(image: ToolImage, toolName: string): string {
	return `image from ${toolName} (${image.mediaType}, ${formatBytes(image.bytes)})`;
}

function formatBytes(bytes: number): string {
	return bytes < 1024 * 1024
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = stylex.create({
	list: {
		gridColumn: "2 / -1",
		display: "flex",
		flexWrap: "wrap",
		gap: "0.45rem",
		margin: 0,
		padding: "0.4rem 0 0",
		listStyle: "none",
		borderTop: "1px solid var(--border)",
	},
	thumbnailButton: {
		display: "block",
		padding: 0,
		borderWidth: 1,
		borderStyle: "solid",
		borderColor: { default: "var(--border)", ":hover": "var(--border-strong)" },
		borderRadius: 6,
		backgroundColor: "var(--bg)",
		cursor: "zoom-in",
		overflow: "hidden",
	},
	thumbnailButtonExpanded: { cursor: "zoom-out" },
	image: { display: "block", width: "9rem", height: "6rem", objectFit: "contain" },
	imageExpanded: {
		width: "auto",
		height: "auto",
		minWidth: "9rem",
		minHeight: "6rem",
		maxWidth: "min(100%, 42rem)",
		maxHeight: "32rem",
	},
	omitted: {
		display: "inline-block",
		padding: "0.3rem 0.5rem",
		borderRadius: 6,
		borderWidth: 1,
		borderStyle: "dashed",
		borderColor: "var(--border-strong)",
		color: "var(--muted)",
		fontSize: "0.68rem",
	},
});
