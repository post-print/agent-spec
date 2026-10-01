import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ownerIsActive, type ProcessOwner, processOwner } from "./process-owner.js";

export const SEALED_WORKSPACE_DIR_PREFIX = "agent-harness-seal-";
interface SealedManifest {
	version: 1;
	kind: "agent-harness-sealed-workspace";
	callerCwd: string;
	createdAt: string;
	owner: ProcessOwner;
}
const MANIFEST = "owner.json";

/** Only versioned harness-owned roots are swept; legacy/unrecognized roots are preserved. */
export async function recoverSealedWorkspaces(
	options: { temporaryRoot?: string; minimumAgeMs?: number } = {},
): Promise<void> {
	const root = options.temporaryRoot ?? tmpdir();
	const minimumAgeMs = options.minimumAgeMs ?? 24 * 60 * 60 * 1000;
	validateAge(minimumAgeMs);
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!isSealedRoot(entry)) continue;
		const path = join(root, entry.name);
		const manifest = await readManifest(path);
		if (!manifest) continue;
		if (!(await canRecover(manifest, minimumAgeMs))) continue;
		await rm(path, { recursive: true, force: true });
	}
}

function validateAge(age: number): void {
	if (!Number.isFinite(age) || age < 0) throw new Error("minimumAgeMs must be nonnegative");
}
async function canRecover(manifest: SealedManifest, minimumAgeMs: number): Promise<boolean> {
	return (
		Date.now() - Date.parse(manifest.createdAt) >= minimumAgeMs &&
		!(await ownerIsActive(manifest.owner))
	);
}

function isSealedRoot(entry: { isDirectory(): boolean; name: string }): boolean {
	return entry.isDirectory() && entry.name.startsWith(SEALED_WORKSPACE_DIR_PREFIX);
}

async function readManifest(root: string): Promise<SealedManifest | undefined> {
	try {
		const value = JSON.parse(await readFile(join(root, MANIFEST), "utf8")) as SealedManifest;
		if (value.version !== 1 || value.kind !== "agent-harness-sealed-workspace") return;
		if (!Number.isInteger(value.owner?.pid) || value.owner.pid <= 0) return;
		if (!Number.isFinite(Date.parse(value.createdAt))) return;
		return value;
	} catch {
		return;
	}
}

export async function allocateSealedWorkspace(callerCwd: string) {
	await recoverSealedWorkspaces();
	const root = await mkdtemp(join(tmpdir(), SEALED_WORKSPACE_DIR_PREFIX));
	try {
		const manifest: SealedManifest = {
			version: 1,
			kind: "agent-harness-sealed-workspace",
			callerCwd: resolve(callerCwd),
			createdAt: new Date().toISOString(),
			owner: await processOwner(),
		};
		await writeFile(join(root, MANIFEST), JSON.stringify(manifest));
		const path = join(root, "workspace");
		await mkdir(path);
		return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}
