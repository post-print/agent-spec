import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { WorkspaceEscapeError } from "./agent-error.js";
import { shellSegments } from "./shell-paths.js";
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
	const sealed = await allocateSealedWorkspace();
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

/** Read-only toolchain roots a shell command may name without leaving the task. */
const SYSTEM_READ_ROOTS = ["/bin", "/usr", "/sbin", "/System", "/Library", "/opt", "/dev"];
const HOME_PREFIX = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/;
const PATH_ARG_KEYS = ["path", "file_path", "filePath", "target_file", "uri", "cwd"];

/** A path named by a tool call, resolved against the directory it was used from. */
interface NamedPath {
	raw: string;
	absolute: string;
}

function isSystemPath(absolute: string): boolean {
	return SYSTEM_READ_ROOTS.some((root) => isPathUnderRoot(absolute, root));
}
function isCursorToolOutput(path: string): boolean {
	return path.includes("/.cursor/projects/") && path.includes("/agent-tools/");
}
function expandHome(token: string): string {
	return token.replace(HOME_PREFIX, homedir());
}
function namedPath(raw: string, from: string): NamedPath {
	const value = expandHome(raw.replace(FILE_PROTOCOL, ""));
	return { raw, absolute: isAbsolute(value) ? resolve(value) : resolve(from, value) };
}

/**
 * A shell token that names a filesystem location rather than a pattern or flag.
 * Absolute tokens count only when their top-level directory exists, so `awk '/x/'`
 * is not mistaken for a path.
 */
function isShellPathToken(token: string): boolean {
	const value = token.replace(TRAILING_PUNCTUATION, "");
	if (HOME_PREFIX.test(value) || value.split("/").includes("..")) return true;
	if (!value.startsWith("/") || value.startsWith("//")) return false;
	const topLevel = `/${value.split("/")[1] ?? ""}`;
	return topLevel !== "/" && existsSync(topLevel);
}

/** Paths named in a shell command, following `cd` so relative paths resolve correctly. */
function shellCommandPaths(command: string, cwd: string): NamedPath[] {
	const paths: NamedPath[] = [];
	let current = cwd;
	for (const { tokens } of shellSegments(command)) {
		const named = tokens.filter(isShellPathToken).map((token) => namedPath(token, current));
		paths.push(...named);
		if (tokens[0] === "cd" && tokens[1]) current = namedPath(tokens[1], current).absolute;
	}
	return paths;
}

function toolCallPaths(args: Record<string, unknown> | undefined, root: string): NamedPath[] {
	if (!args) return [];
	const cwd = typeof args.cwd === "string" ? namedPath(args.cwd, root).absolute : root;
	const paths = PATH_ARG_KEYS.map((key) => args[key])
		.filter((value): value is string => typeof value === "string")
		.map((value) => namedPath(value, root));
	if (typeof args.pattern === "string" && isAbsolute(args.pattern))
		paths.push(namedPath(args.pattern, root));
	if (typeof args.command === "string") paths.push(...shellCommandPaths(args.command, cwd));
	return paths;
}

function escapesWorkspace(path: NamedPath, root: string): boolean {
	if (isCursorToolOutput(path.absolute.replaceAll("\\", "/"))) return false;
	return !isPathUnderRoot(path.absolute, root) && !isSystemPath(path.absolute);
}

/**
 * Paths a tool call named outside the sealed workspace. Shell commands are unwrapped
 * and scanned for absolute, home-relative, and parent-relative tokens; only read-only
 * system toolchain roots are allowed.
 */
export function toolPathsOutsideWorkspace(trace: AgentTrace, workspaceRoot: string): string[] {
	const root = resolve(workspaceRoot);
	const escaped = trace.toolCalls
		.flatMap((call) => toolCallPaths(call.args, root))
		.filter((path) => escapesWorkspace(path, root))
		.map((path) => path.raw);
	return [...new Set(escaped)];
}

/** Reject a trace whose tool calls named paths outside the sealed workspace. */
export function assertInsideWorkspace(trace: AgentTrace, workspaceRoot: string): void {
	const escaped = toolPathsOutsideWorkspace(trace, workspaceRoot);
	if (escaped.length) throw new WorkspaceEscapeError(escaped, trace);
}
