import { existsSync, readFileSync } from "node:fs";
import type { ViewerBootstrap } from "./bootstrap.js";

export interface ViewerPageRenderOptions {
	baseCss?: string;
}

function embedJson(value: unknown): string {
	return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function readBuiltViewer(): string {
	const paths = [
		new URL("./client-entry.js", import.meta.url),
		new URL("../../dist/viewer/client-entry.js", import.meta.url),
	];
	const path = paths.find((candidate) => existsSync(candidate));
	if (!path)
		throw new Error("Viewer client bundle is missing. Run the @post-print/agent-test build first.");
	return readFileSync(path, "utf8").replaceAll("</script", "<\\/script");
}

function readStylex(): string {
	const paths = [
		new URL("./stylex.css", import.meta.url),
		new URL("../../dist/viewer/stylex.css", import.meta.url),
	];
	const path = paths.find((candidate) => existsSync(candidate));
	return path ? readFileSync(path, "utf8").replaceAll("</style", "<\\/style") : "";
}

export function renderViewerPage(
	bootstrap: ViewerBootstrap,
	options: ViewerPageRenderOptions = {},
): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>agent-test viewer</title>
  <style>${options.baseCss ?? ""}${readStylex()}</style>
</head>
<body>
  <div id="viewer-root"></div>
  <script type="application/json" id="bootstrap-data">${embedJson(bootstrap)}</script>
  <script>${readBuiltViewer()}</script>
</body>
</html>`;
}
