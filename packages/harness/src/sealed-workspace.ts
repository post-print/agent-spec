import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { SKILL_ROOTS, skillOverlayRelPath } from "./skills-context.js";
import type { AgentTrace } from "./types.js";
import { isPathUnderRoot } from "./working-tree-guard.js";

const execFileAsync = promisify(execFile);

export const SEALED_WORKSPACE_DIR_PREFIX = "agent-harness-seal-";

export interface SealedWorkspace {
	path: string;
	cleanup: () => Promise<void>;
}

export interface ReadOnlyWorkspaceSnapshot {
	path: string;
	cleanup: () => Promise<void>;
}

async function makeTreeReadOnly(root: string): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) await makeTreeReadOnly(path);
		await chmod(path, entry.isDirectory() ? 0o555 : 0o444);
	}
	await chmod(root, 0o555);
}

async function makeTreeWritable(root: string): Promise<void> {
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) await makeTreeWritable(path);
		await chmod(path, entry.isDirectory() ? 0o755 : 0o644);
	}
	await chmod(root, 0o755);
}

/** Snapshot an arm for judge inspection; the snapshot is immutable at the OS boundary. */
export async function createReadOnlyWorkspaceSnapshot(
	source: string,
	name: string,
): Promise<ReadOnlyWorkspaceSnapshot> {
	const root = await mkdtemp(join(tmpdir(), "agent-harness-judge-"));
	const path = join(root, name);
	try {
		await cp(source, path, { recursive: true, filter: skipNestedGit });
		await makeTreeReadOnly(path);
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
	return {
		path,
		cleanup: async () => {
			await makeTreeWritable(root).catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		},
	};
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
	const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "").trim();
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

/** True when the run should copy caller HEAD instead of a fixture folder. */
export function isCallerHeadWorkspace(raw: unknown): boolean {
	const parsed = parseScenarioWorkspace(raw);
	return parsed.ok && parsed.rel === undefined;
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
	const normalized = rel.replace(/^\.\//, "").trim();
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
	const dest = await mkdtemp(join(tmpdir(), SEALED_WORKSPACE_DIR_PREFIX));
	const parsed = parseScenarioWorkspace(options.workspace);
	if (!parsed.ok) {
		await rm(dest, { recursive: true, force: true });
		throw new Error(parsed.message);
	}

	if (parsed.rel) {
		await materializeWorkspaceFolder(options.callerCwd, parsed.rel, dest);
	} else {
		await materializeGitHead(options.callerCwd, dest);
		for (const rel of options.overlayPaths ?? []) {
			await overlayPath(options.callerCwd, dest, rel);
		}
	}
	await initNestedGit(dest);

	return {
		path: dest,
		cleanup: async () => {
			await rm(dest, { recursive: true, force: true });
		},
	};
}

function candidatePathsFromArgs(args: Record<string, unknown> | undefined): string[] {
	if (!args) {
		return [];
	}
	const paths: string[] = [];
	for (const key of ["path", "file_path", "filePath", "target_file", "uri", "cwd"]) {
		const value = args[key];
		if (typeof value === "string") {
			paths.push(value.replace(/^file:\/\//, ""));
		}
	}
	const command = args.command;
	if (typeof command === "string") {
		const ignoredExecutables = new Set(["/bin/bash", "/bin/sh", "/bin/zsh", "/usr/bin/env"]);
		for (const match of command.matchAll(/(?:^|[\s"'])((?:\.\.\/|\/)[^\s"';&|)]+)/g)) {
			const path = match[1]?.replace(/[,:]+$/, "");
			// Shell commands often inspect runner temp folders while running tests.
			// Only flag external agent configuration paths here; direct tool path
			// arguments still use the complete escape check below.
			if (
				path &&
				!ignoredExecutables.has(path) &&
				(path.includes("/.agents/skills/") ||
					path.endsWith("/AGENTS.md") ||
					path.endsWith("/CLAUDE.md") ||
					path.includes("/.cursor/"))
			) {
				paths.push(path);
			}
		}
	}
	return paths;
}

/** Tool paths that resolve outside the sealed workspace. */
export function toolPathsOutsideWorkspace(trace: AgentTrace, workspaceRoot: string): string[] {
	const root = resolve(workspaceRoot);
	const escaped: string[] = [];
	for (const call of trace.toolCalls) {
		for (const raw of candidatePathsFromArgs(call.args)) {
			const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
			const normalized = abs.replaceAll("\\", "/");
			if (normalized.includes("/.cursor/projects/") && normalized.includes("/agent-tools/")) {
				continue;
			}
			if (!isPathUnderRoot(abs, root)) {
				escaped.push(raw);
			}
		}
	}
	return [...new Set(escaped)];
}
