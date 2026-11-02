import { chmod, lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerIsActive, type ProcessOwner, processOwner } from "./process-owner.js";

const MANIFEST = "owner.json";
const DEFAULT_MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

/** A family of temp directories the harness creates and can later prove it created. */
export interface OwnedRootKind {
	prefix: string;
	kind: string;
}
interface OwnerManifest {
	version: 1;
	kind: string;
	createdAt: string;
	owner: ProcessOwner;
}

export async function writeOwnerManifest(root: string, rootKind: OwnedRootKind): Promise<void> {
	const manifest: OwnerManifest = {
		version: 1,
		kind: rootKind.kind,
		createdAt: new Date().toISOString(),
		owner: await processOwner(),
	};
	await writeFile(join(root, MANIFEST), JSON.stringify(manifest));
}

/** Removes roots of this kind whose owner is gone. A root without a valid manifest is preserved. */
export async function recoverOwnedRoots(
	rootKind: OwnedRootKind,
	options: { temporaryRoot?: string; minimumAgeMs?: number } = {},
): Promise<void> {
	const root = options.temporaryRoot ?? tmpdir();
	const minimumAgeMs = options.minimumAgeMs ?? DEFAULT_MINIMUM_AGE_MS;
	validateAge(minimumAgeMs);
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(rootKind.prefix)) continue;
		const path = join(root, entry.name);
		const manifest = await readManifest(path, rootKind);
		if (!manifest) continue;
		if (!(await canRecover(manifest, minimumAgeMs))) continue;
		await removeOwnedTree(path);
	}
}

/** An agent can leave read-only folders, as Go module caches are. They are still ours to remove. */
async function makeWritable(path: string): Promise<void> {
	const stats = await lstat(path);
	if (!stats.isDirectory()) return;
	await chmod(path, stats.mode | 0o700);
	for (const name of await readdir(path)) await makeWritable(join(path, name));
}
export async function removeOwnedTree(path: string): Promise<void> {
	try {
		await rm(path, { recursive: true, force: true });
	} catch {
		await makeWritable(path);
		await rm(path, { recursive: true, force: true });
	}
}

function validateAge(age: number): void {
	if (!Number.isFinite(age) || age < 0) throw new Error("minimumAgeMs must be nonnegative");
}

async function canRecover(manifest: OwnerManifest, minimumAgeMs: number): Promise<boolean> {
	return (
		Date.now() - Date.parse(manifest.createdAt) >= minimumAgeMs &&
		!(await ownerIsActive(manifest.owner))
	);
}

async function readManifest(
	root: string,
	rootKind: OwnedRootKind,
): Promise<OwnerManifest | undefined> {
	try {
		const value = JSON.parse(await readFile(join(root, MANIFEST), "utf8")) as OwnerManifest;
		if (value.version !== 1 || value.kind !== rootKind.kind) return;
		if (!Number.isInteger(value.owner?.pid) || value.owner.pid <= 0) return;
		if (!Number.isFinite(Date.parse(value.createdAt))) return;
		return value;
	} catch {
		return;
	}
}
