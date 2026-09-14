import type { ViewerContextFile, ViewerContextReason } from "./events.js";

export const VIEWER_CONTEXT_FILE_CHARS = 4_000;

export function truncateViewerText(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max)}\n… (truncated)`;
}

export function classifyContextReason(
	path: string,
	contextSources: string[] = [],
): ViewerContextReason {
	const needle = path.replace(/^\.\//, "");
	if (contextSources.some((source) => source.replace(/^\.\//, "") === needle)) {
		return "contextSources";
	}
	if (
		/(?:^|\/)SKILL\.md$/.test(needle) ||
		/(?:^|\/)\.agents\/skills\//.test(needle) ||
		/(?:^|\/)\.claude\/skills\//.test(needle)
	) {
		return "skills";
	}
	return "profile";
}

export function contextWhy(path: string, reason: ViewerContextReason): string {
	if (reason === "contextSources") {
		return `The scenario lists ${path} in contextSources.`;
	}
	if (reason === "skills") {
		return `The scenario skills setting loaded ${path}.`;
	}
	return `The host profile loaded ${path}.`;
}

function contextFile(path: string, text: string, contextSources: string[]): ViewerContextFile {
	const reason = classifyContextReason(path, contextSources);
	return {
		path,
		text: truncateViewerText(text, VIEWER_CONTEXT_FILE_CHARS),
		reason,
		why: contextWhy(path, reason),
	};
}

/** Split a loaded preamble into path and text pairs for the viewer. */
export function viewerContextFiles(
	preamble: string,
	sources: string[],
	contextSources: string[] = [],
): ViewerContextFile[] {
	const chunks = preamble.split("\n\n---\n\n");
	const files: ViewerContextFile[] = [];
	for (const chunk of chunks) {
		const trimmed = chunk.trim();
		if (!trimmed) {
			continue;
		}
		const match = trimmed.match(/^<!-- ([^\n]+) -->\n?([\s\S]*)$/);
		if (match?.[1]) {
			files.push(contextFile(match[1].trim(), match[2].trimEnd(), contextSources));
			continue;
		}
		files.push(contextFile(sources[files.length] ?? "context", trimmed, contextSources));
	}
	return files;
}
