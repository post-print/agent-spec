import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	type AgentDefinition,
	createSealedWorkspace,
	type SealedWorkspace,
} from "@post-print/agent-harness";

export interface Workspace {
	path: string;
	readFile(path: string): Promise<string>;
}
export interface WorkspaceSnapshot {
	path: string;
	files: Record<string, { sha256: string; bytes: number }>;
}
export function under(root: string, path: string): string {
	const target = resolve(root, path);
	const rel = relative(resolve(root), target);
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
		throw new Error(`Path escapes workspace: ${path}`);
	return target;
}
export async function copyTree(source: string, target: string): Promise<void> {
	await mkdir(target, { recursive: true });
	for (const item of await readdir(source, { withFileTypes: true })) {
		if ([".git", "node_modules"].includes(item.name)) continue;
		if (item.isSymbolicLink())
			throw new Error(`Workspace snapshots do not support symlinks: ${join(source, item.name)}`);
		const from = join(source, item.name),
			to = join(target, item.name);
		if (item.isDirectory()) await copyTree(from, to);
		else if (item.isFile()) await cp(from, to);
	}
}
export async function snapshot(source: string, target: string): Promise<WorkspaceSnapshot> {
	await copyTree(source, target);
	const files: WorkspaceSnapshot["files"] = {};
	async function walk(path: string) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) await walk(full);
			else {
				const bytes = await readFile(full);
				files[relative(target, full).split(sep).join("/")] = {
					sha256: createHash("sha256").update(bytes).digest("hex"),
					bytes: bytes.length,
				};
			}
		}
	}
	await walk(target);
	return { path: target, files };
}
export function changedPaths(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
	return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
		.filter((path) => before.files[path]?.sha256 !== after.files[path]?.sha256)
		.sort();
}
export async function prepareWorkspace(
	baseDir: string,
	source: string,
): Promise<SealedWorkspace & Workspace> {
	const sealed = await createSealedWorkspace({
		callerCwd: baseDir,
		workspace: source,
		overlayPaths: [],
	});
	return {
		...sealed,
		path: await realpath(sealed.path),
		async readFile(path) {
			const actual = await realpath(under(sealed.path, path));
			return readFile(under(await realpath(sealed.path), actual), "utf8");
		},
	};
}
export interface StartingContext {
	instructions: string[];
	files: { path: string; content: string }[];
	skills: { source: string; destination: string }[];
	includeGlobalSkills: boolean;
}
export async function prepareAgent(
	agent: AgentDefinition,
	baseDir: string,
	workspace: string,
): Promise<StartingContext> {
	const context: StartingContext = {
		instructions: [...(agent.options.context?.instructions ?? [])],
		files: [],
		skills: [],
		includeGlobalSkills: agent.options.includeGlobalSkills === true,
	};
	for (const file of agent.options.context?.files ?? [])
		context.files.push({ path: file, content: await readFile(resolve(baseDir, file), "utf8") });
	for (const skill of agent.options.skills ?? []) {
		const source = resolve(baseDir, skill);
		await readFile(join(source, "SKILL.md"), "utf8");
		const root =
			agent.host === "claude"
				? ".claude/skills"
				: agent.host === "cursor"
					? ".cursor/skills"
					: ".agents/skills";
		const destination = join(root, basename(source));
		const target = under(workspace, destination);
		await mkdir(dirname(target), { recursive: true });
		await copyTree(source, target);
		context.skills.push({ source: skill, destination });
	}
	return context;
}
export function withContext(prompt: string, context: StartingContext): string {
	if (!context.instructions.length && !context.files.length) return prompt;
	return `Session instructions:\n${context.instructions.join("\n")}\n\nStarting context:\n${JSON.stringify(context.files)}\n\nUser request:\n${prompt}`;
}
export async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value, null, 2));
}
