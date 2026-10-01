import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { SKILL_ROOTS, skillOverlayRelPath } from "./skills-context.js";
import type { AgentTrace } from "./types.js";
import { isPathUnderRoot } from "./working-tree-guard.js";

const BACKSLASH = /\\/g;
const RELATIVE_PREFIX = /^\.\//;
const FILE_PROTOCOL = /^file:\/\//;
const TRAILING_PUNCTUATION = /[,:]+$/;

const execFileAsync = promisify(execFile);

export { SEALED_WORKSPACE_DIR_PREFIX } from "./sealed-storage.js";

import { allocateSealedWorkspace } from "./sealed-storage.js";

export interface SealedWorkspace {
	path: string;
	cleanup: () => Promise<void>;
}

export interface CreateSealedWorkspaceOptions {
	callerCwd: string;
	/** Caller-relative files or directories to overlay after the HEAD snapshot. */
	overlayPaths?: string[];
	/**
	 * Caller-relative folder that becomes the sealed repo.
	 * Omit, empty, or `"."` keeps `git archive HEAD`.
	 */
	workspace?: string;
}

export type ParsedScenarioWorkspace =
	| { ok: true; rel: string | undefined }
	| { ok: false; message: string };

/**
 * Parse `workspace`. `undefined`, empty, and `"."` mean caller HEAD.
 * Subfolder paths must stay repo-relative and must not contain `..`.
 */
export function parseScenarioWorkspace(raw: unknown): ParsedScenarioWorkspace {
	if (raw === undefined) {
		return { ok: true, rel: undefined };
	}
	if (typeof raw !== "string") {
		return { ok: false, message: `workspace must be a string, got ${JSON.stringify(raw)}` };
	}
	const normalized = raw.replace(BACKSLASH, "/").replace(RELATIVE_PREFIX, "").trim();
	if (normalized.length === 0 || normalized === ".") {
		return { ok: true, rel: undefined };
	}
	if (isAbsolute(raw) || normalized.startsWith("/")) {
		return {
			ok: false,
			message: `workspace must be a repo-relative folder, got ${JSON.stringify(raw)}`,
		};
	}
	const parts = normalized.split("/").filter((part) => part.length > 0);
	if (parts.some((part) => part === ".." || part === ".")) {
		return {
			ok: false,
			message: `workspace must not contain '..' segments, got ${JSON.stringify(raw)}`,
		};
	}
	return { ok: true, rel: parts.join("/") };
}

async function materializeGitHead(callerCwd: string, dest: string): Promise<void> {
	try {
		await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: callerCwd });
	} catch {
		return;
	}
	const archivePath = join(dest, ".git-archive.tar");
	await execFileAsync("git", ["archive", "--format=tar", "-o", archivePath, "HEAD"], {
		cwd: callerCwd,
	});
	await execFileAsync("tar", ["-xf", archivePath, "-C", dest]);
	await rm(archivePath, { force: true });
}

function skipNestedGit(source: string): boolean {
	const parts = source.split(sep);
	return !parts.includes(".git");
}

async function materializeWorkspaceFolder(
	callerCwd: string,
	workspaceRel: string,
	dest: string,
): Promise<void> {
	const root = resolve(callerCwd);
	const from = resolve(callerCwd, workspaceRel);
	if (!isPathUnderRoot(from, root)) {
		throw new Error(`workspace must stay under the caller cwd: ${workspaceRel}`);
	}
	await rm(dest, { recursive: true, force: true });
	await cp(from, dest, { recursive: true, filter: skipNestedGit });
}

async function overlayPath(callerCwd: string, dest: string, rel: string): Promise<void> {
	const normalized = rel.replace(RELATIVE_PREFIX, "").trim();
	if (!normalized || normalized.includes("\0")) {
		return;
	}
	const from = resolve(callerCwd, normalized);
	if (!isPathUnderRoot(from, resolve(callerCwd))) {
		return;
	}
	const to = join(dest, normalized);
	try {
		await mkdir(dirname(to), { recursive: true });
		await cp(from, to, { recursive: true, force: true });
	} catch {
		// Missing overlay sources are skipped.
	}
}

/** Caller-relative trees copied into every sealed run so hosts see local context. */
export function defaultSealedOverlayPaths(extra?: string[], skillPaths?: string[]): string[] {
	const extraSkillOverlays = (skillPaths ?? []).map((path) => skillOverlayRelPath(path));
	return [
		"AGENTS.md",
		"CLAUDE.md",
		".cursor/rules",
		".skeleton/registry.md",
		"skeleton.toml",
		".skeleton/config.yaml",
		".skeleton/customize",
		...SKILL_ROOTS,
		...extraSkillOverlays,
		...(extra ?? []),
	];
}

async function initNestedGit(dest: string): Promise<void> {
	await execFileAsync("git", ["init", "-b", "main"], { cwd: dest });
	await execFileAsync("git", ["config", "user.email", "harness@local"], { cwd: dest });
	await execFileAsync("git", ["config", "user.name", "agent-harness"], { cwd: dest });
	await execFileAsync("git", ["add", "-A"], { cwd: dest });
	try {
		await execFileAsync("git", ["commit", "-m", "sealed workspace"], { cwd: dest });
	} catch {
		// Empty tree still keeps .git so git does not walk to the caller repo.
	}
}

/** Copy HEAD plus caller context into a temp folder the agent should not leave. */
export async function createSealedWorkspace(
	options: CreateSealedWorkspaceOptions,
): Promise<SealedWorkspace> {
	const parsed = parseScenarioWorkspace(options.workspace);
	if (!parsed.ok) throw new Error(parsed.message);
	const sealed = await allocateSealedWorkspace(options.callerCwd);
	try {
		await materializeSealedWorkspace(options, parsed.rel, sealed.path);
		await initNestedGit(sealed.path);
		return sealed;
	} catch (error) {
		await sealed.cleanup();
		throw error;
	}
}

async function materializeSealedWorkspace(
	options: CreateSealedWorkspaceOptions,
	workspaceRel: string | undefined,
	dest: string,
): Promise<void> {
	if (workspaceRel) {
		await materializeWorkspaceFolder(options.callerCwd, workspaceRel, dest);
		return;
	}
	await materializeGitHead(options.callerCwd, dest);
	for (const rel of options.overlayPaths ?? []) await overlayPath(options.callerCwd, dest, rel);
}

function candidatePathsFromArgs(args: Record<string, unknown> | undefined): string[] {
	if (!args) {
		return [];
	}
	const paths: string[] = [];
	for (const key of ["path", "file_path", "filePath", "target_file", "uri", "cwd"]) {
		const value = args[key];
		if (typeof value === "string") {
			paths.push(value.replace(FILE_PROTOCOL, ""));
		}
	}
	paths.push(...contextPathsFromCommand(args.command));
	return paths;
}

function contextPathsFromCommand(command: unknown): string[] {
	const paths: string[] = [];

	if (typeof command === "string") {
		const ignoredExecutables = new Set(["/bin/bash", "/bin/sh", "/bin/zsh", "/usr/bin/env"]);
		for (const match of command.matchAll(/(?:^|[\s"'])((?:\.\.\/|\/)[^\s"';&|)]+)/g)) {
			const path = match[1]?.replace(TRAILING_PUNCTUATION, "");
			// Shell commands often inspect runner temp folders while running tests.
			// Only flag external agent configuration paths here; direct tool path
			// arguments still use the complete escape check below.
			if (path && !ignoredExecutables.has(path) && isAgentContextPath(path)) {
				paths.push(path);
			}
		}
	}
	return paths;
}
function isAgentContextPath(path: string): boolean {
	return (
		path.includes("/.agents/skills/") ||
		path.endsWith("/AGENTS.md") ||
		path.endsWith("/CLAUDE.md") ||
		path.includes("/.cursor/")
	);
}
function isCursorToolOutput(path: string): boolean {
	return path.includes("/.cursor/projects/") && path.includes("/agent-tools/");
}
/** Tool paths that resolve outside the sealed workspace. */
export function toolPathsOutsideWorkspace(trace: AgentTrace, workspaceRoot: string): string[] {
	const root = resolve(workspaceRoot);
	const escaped: string[] = [];
	for (const raw of trace.toolCalls.flatMap((call) => candidatePathsFromArgs(call.args))) {
		const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
		const normalized = abs.replaceAll("\\", "/");
		if (isCursorToolOutput(normalized)) {
			continue;
		}
		if (!isPathUnderRoot(abs, root)) {
			escaped.push(raw);
		}
	}
	return [...new Set(escaped)];
}
