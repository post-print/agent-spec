import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OwnedRootKind, recoverOwnedRoots, writeOwnerManifest } from "./owned-temp-root.js";

export const SEALED_WORKSPACE_DIR_PREFIX = "agent-harness-seal-";
const SEALED_ROOT: OwnedRootKind = {
	prefix: SEALED_WORKSPACE_DIR_PREFIX,
	kind: "agent-harness-sealed-workspace",
};

/** Only versioned harness-owned roots are swept; legacy/unrecognized roots are preserved. */
export function recoverSealedWorkspaces(
	options: { temporaryRoot?: string; minimumAgeMs?: number } = {},
): Promise<void> {
	return recoverOwnedRoots(SEALED_ROOT, options);
}

/** Allocate an owned temp root. The manifest names no caller path: the agent can read it. */
export async function allocateSealedWorkspace() {
	await recoverSealedWorkspaces();
	const root = await mkdtemp(join(tmpdir(), SEALED_WORKSPACE_DIR_PREFIX));
	try {
		await writeOwnerManifest(root, SEALED_ROOT);
		const path = join(root, "workspace");
		await mkdir(path);
		return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}
