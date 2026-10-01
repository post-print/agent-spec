import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	statfs,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MIB = 1024 * 1024;
export interface SnapshotBudget {
	maximumBytes: number;
	usedBytes: number;
	minimumFreeBytes: number;
	excludedNames: Set<string>;
}
export function snapshotBudget(): SnapshotBudget {
	return {
		maximumBytes: storageLimit("AGENT_TEST_SNAPSHOT_MAX_BYTES", 1024 * MIB),
		usedBytes: 0,
		minimumFreeBytes: storageLimit("AGENT_TEST_MIN_FREE_BYTES", 1024 * MIB),
		excludedNames: new Set([
			".git",
			"node_modules",
			".agent-test",
			".qualification-cache",
			".venv",
			"__pycache__",
			...(process.env.AGENT_TEST_SNAPSHOT_EXCLUDE_NAMES?.split(",").filter(Boolean) ?? []),
		]),
	};
}
function storageLimit(name: string, fallback: number): number {
	const raw = process.env[name];
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isSafeInteger(value) || value < 0)
		throw new Error(`${name} must be a nonnegative safe integer`);
	return value;
}
export type SnapshotFiles = Record<string, { sha256: string; bytes: number }>;
interface SnapshotManifest {
	version: 1;
	kind: "agent-test-snapshot";
	status: "copying" | "available" | "removed";
	files: SnapshotFiles;
}
export async function captureSnapshot(input: {
	source: string;
	target: string;
	budget: SnapshotBudget;
}): Promise<SnapshotFiles> {
	const { source, target, budget } = input;
	await mkdir(dirname(target), { recursive: true });
	await mkdir(target);
	const manifest: SnapshotManifest = {
		version: 1,
		kind: "agent-test-snapshot",
		status: "copying",
		files: {},
	};
	try {
		await saveManifest(`${target}.snapshot.json`, manifest);
		await copySnapshotDirectory({ source, target, root: target, budget, files: manifest.files });
		manifest.status = "available";
		await saveManifest(`${target}.snapshot.json`, manifest);
		return manifest.files;
	} catch (error) {
		await rm(target, { recursive: true, force: true });
		manifest.status = "removed";
		await saveManifest(`${target}.snapshot.json`, manifest);
		throw error;
	}
}
interface CopyInput {
	source: string;
	target: string;
	root: string;
	budget: SnapshotBudget;
	files: SnapshotFiles;
}
async function copySnapshotDirectory(input: CopyInput): Promise<void> {
	for (const item of await readdir(input.source, { withFileTypes: true })) {
		if (input.budget.excludedNames.has(item.name)) continue;
		const source = join(input.source, item.name),
			target = join(input.target, item.name);
		if (item.isSymbolicLink())
			throw new Error(`Workspace snapshots do not support symlinks: ${source}`);
		if (item.isDirectory()) {
			await mkdir(target);
			await copySnapshotDirectory({ ...input, source, target });
		} else if (item.isFile()) {
			input.files[relative(input.root, target).split(sep).join("/")] = await copySnapshotFile(
				source,
				target,
				input.budget,
			);
		}
	}
}
async function copySnapshotFile(source: string, target: string, budget: SnapshotBudget) {
	const space = await statfs(dirname(target));
	const sourceInfo = await stat(source);
	const sourceSize = sourceInfo.size;
	if (space.bavail * space.bsize - sourceSize < budget.minimumFreeBytes)
		throw new Error("Snapshot storage has insufficient free space");
	const hash = createHash("sha256");
	let bytes = 0;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			if (budget.usedBytes + chunk.length > budget.maximumBytes) {
				callback(new Error(`Snapshot storage budget exceeded (${budget.maximumBytes} bytes)`));
				return;
			}
			budget.usedBytes += chunk.length;
			bytes += chunk.length;
			hash.update(chunk);
			callback(null, chunk);
		},
	});
	await pipeline(
		createReadStream(source),
		meter,
		createWriteStream(target, { flags: "wx", mode: sourceInfo.mode & 0o777 }),
	);
	return { bytes, sha256: hash.digest("hex") };
}

/** Deletes only snapshot copies carrying our sidecar; evidence and arbitrary attachments survive. */
export async function releaseSnapshots(root: string): Promise<void> {
	const entries = await snapshotEntries(root);
	const released = new Set<string>();
	for (const entry of entries) {
		if (!entry.isFile() || !["initial.snapshot.json", "final.snapshot.json"].includes(entry.name))
			continue;
		if (await releaseSnapshot(join(root, entry.name)))
			released.add(entry.name.slice(0, -".snapshot.json".length));
	}
	for (const entry of entries) {
		if (entry.isDirectory() && entry.name !== "changed-files" && !released.has(entry.name))
			await releaseSnapshots(join(root, entry.name));
	}
}
async function releaseSnapshot(path: string): Promise<boolean> {
	const manifest = await readManifest(path);
	if (!manifest) return false;
	const target = path.slice(0, -".snapshot.json".length);
	if (!["initial", "final"].includes(basename(target))) return false;
	const info = await lstat(target).catch(() => undefined);
	if (info?.isSymbolicLink()) return false;
	await rm(target, { recursive: true, force: true });
	await saveManifest(path, { ...manifest, status: "removed" });
	return true;
}
async function readManifest(path: string): Promise<SnapshotManifest | undefined> {
	try {
		const manifest = JSON.parse(await readFile(path, "utf8")) as SnapshotManifest;
		return manifest.version === 1 && manifest.kind === "agent-test-snapshot" ? manifest : undefined;
	} catch {
		return undefined;
	}
}
async function saveManifest(path: string, manifest: SnapshotManifest): Promise<void> {
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(manifest));
	await rename(temporary, path);
}

async function snapshotEntries(root: string) {
	try {
		return await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export function sourceEvidenceBudget(): SnapshotBudget {
	return {
		...snapshotBudget(),
		maximumBytes: storageLimit("AGENT_TEST_SOURCE_EVIDENCE_MAX_BYTES", 16 * MIB),
	};
}
/** Keep bounded changed-file contents separately from disposable full-tree copies. */
export async function preserveSourceChanges(input: {
	initial: { files: SnapshotFiles };
	final: { path: string; files: SnapshotFiles };
	directory: string;
	budget: SnapshotBudget;
}): Promise<void> {
	const changes: Record<string, "deleted" | "preserved" | "omitted-budget"> = {};
	const paths = new Set([...Object.keys(input.initial.files), ...Object.keys(input.final.files)]);
	for (const path of paths) {
		if (input.initial.files[path]?.sha256 === input.final.files[path]?.sha256) continue;
		const file = input.final.files[path];
		if (!file) {
			changes[path] = "deleted";
			continue;
		}
		if (input.budget.usedBytes + file.bytes > input.budget.maximumBytes) {
			changes[path] = "omitted-budget";
			continue;
		}
		const target = join(input.directory, "changed-files", path);
		await mkdir(dirname(target), { recursive: true });
		await copySnapshotFile(join(input.final.path, path), target, input.budget);
		changes[path] = "preserved";
	}
	await writeFile(join(input.directory, "changes.json"), JSON.stringify({ version: 1, changes }));
}
