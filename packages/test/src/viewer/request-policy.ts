import type { IncomingHttpHeaders } from "node:http";

const LOCAL_AUTHORITY = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i;
const JSON_CONTENT = /^application\/json\s*(?:;|$)/i;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
const INLINE_IMAGE = /^image\/(?:png|jpeg|gif|webp)$/;
const HEADER_SAFE_MIME = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:;[ -~]*)?$/;
const UNSAFE_FILENAME = /[^\w.-]+/g;

export type RequestRefusal = { status: 403 | 415; error: string };

/** A rebound name reaches this server with its own Host, which is how DNS rebinding is stopped. */
function isViewerHost(host: string | undefined, port: number): host is string {
	const match = host?.match(LOCAL_AUTHORITY);
	return match !== undefined && match !== null && Number(match[1] ?? 80) === port;
}
function isSameOrigin(headers: IncomingHttpHeaders): boolean {
	const { origin, host } = headers;
	if (origin !== undefined && origin.toLowerCase() !== `http://${host?.toLowerCase()}`)
		return false;
	return headers["sec-fetch-site"] !== "cross-site";
}

/** Starting a run spends the user's host credits, so a page on another site must never reach it. */
export function requestRefusal(
	{ method, headers }: { method?: string; headers: IncomingHttpHeaders },
	port: number,
): RequestRefusal | undefined {
	if (!isViewerHost(headers.host, port))
		return { status: 403, error: "This viewer only answers on its own local address" };
	if (SAFE_METHODS.has(method ?? "GET")) return undefined;
	if (!isSameOrigin(headers))
		return { status: 403, error: "This request did not come from the viewer" };
	// A cross-site form can only send three content types, and none of them is JSON.
	if (!JSON_CONTENT.test(headers["content-type"] ?? ""))
		return { status: 415, error: "Send application/json" };
	return undefined;
}

/** A browser does not hold a socket to the same-origin rule, so the upgrade has to. */
export function socketRefusal(headers: IncomingHttpHeaders, port: number): boolean {
	return !isViewerHost(headers.host, port) || !isSameOrigin(headers);
}

/**
 * An attachment is written by the agent under test, so nothing in it may run on this origin.
 * Only raster images display in the browser; anything else, SVG and HTML above all, downloads.
 */
export function attachmentHeaders(attachment: { name: string; contentType: string }) {
	const { name, contentType } = attachment;
	return {
		"content-type": HEADER_SAFE_MIME.test(contentType) ? contentType : "application/octet-stream",
		"content-disposition": INLINE_IMAGE.test(contentType)
			? "inline"
			: `attachment; filename="${name.replace(UNSAFE_FILENAME, "_")}"`,
		"x-content-type-options": "nosniff",
		"content-security-policy": "sandbox",
		"cache-control": "no-store",
	};
}
