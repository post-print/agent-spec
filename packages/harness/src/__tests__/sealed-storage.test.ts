import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ownerIsActive, processOwner } from "../process-owner.js";
import { allocateSealedWorkspace, recoverSealedWorkspaces } from "../sealed-storage.js";
import { createSealedWorkspace } from "../sealed-workspace.js";

it("sealed ownership protects live processes and distinguishes PID reuse", async () => {
	const owner = await processOwner();
	expect(await ownerIsActive(owner)).toBe(true);
	if (owner.startedAt)
		expect(await ownerIsActive({ ...owner, startedAt: "different process" })).toBe(false);
});
it("sealed storage cleans normal completion and is idempotent", async () => {
	const sealed = await allocateSealedWorkspace();
	const root = dirname(sealed.path);
	const manifest = JSON.parse(await readFile(join(root, "owner.json"), "utf8"));
	expect(manifest).toMatchObject({ owner: { pid: process.pid } });
	expect(JSON.stringify(manifest)).not.toContain(process.cwd());
	await recoverSealedWorkspaces({ minimumAgeMs: 0 });
	expect(await readdir(sealed.path)).toEqual([]);
	await sealed.cleanup();
	await sealed.cleanup();
	await expect(readdir(root)).rejects.toThrow();
});
it("sealed recovery preserves unknown and young roots and removes only expired dead owners", async () => {
	const root = await mkdtemp(join(tmpdir(), "seal-recovery-"));
	try {
		for (const name of ["legacy", "young", "expired"])
			await mkdir(join(root, `agent-harness-seal-${name}`));
		const manifest = {
			version: 1,
			kind: "agent-harness-sealed-workspace",
			owner: { pid: 999_999 },
		};
		await writeFile(
			join(root, "agent-harness-seal-young", "owner.json"),
			JSON.stringify({ ...manifest, createdAt: new Date().toISOString() }),
		);
		await writeFile(
			join(root, "agent-harness-seal-expired", "owner.json"),
			JSON.stringify({ ...manifest, createdAt: "2020-01-01T00:00:00Z" }),
		);
		await recoverSealedWorkspaces({ temporaryRoot: root });
		expect((await readdir(root)).sort()).toEqual([
			"agent-harness-seal-legacy",
			"agent-harness-seal-young",
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("setup failure removes the allocated root", async () => {
	const before = new Set(await readdir(tmpdir()));
	await expect(
		createSealedWorkspace({ callerCwd: tmpdir(), workspace: "missing-storage-fixture" }),
	).rejects.toThrow();
	const added = (await readdir(tmpdir())).filter(
		(name) => name.startsWith("agent-harness-seal-") && !before.has(name),
	);
	expect(added).toEqual([]);
});
it("forced termination leaves a recoverable manifest and recovery removes the owned root", async () => {
	const module = new URL("../sealed-storage.ts", import.meta.url).pathname;
	const script = `const { allocateSealedWorkspace } = await import(${JSON.stringify(module)}); const s = await allocateSealedWorkspace(); console.log(s.path); setInterval(() => {}, 1000);`;
	const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "inherit" });
	try {
		const reader = child.stdout.getReader();
		const chunk = await reader.read();
		const path = new TextDecoder().decode(chunk.value).trim();
		reader.releaseLock();
		child.kill("SIGKILL");
		await child.exited;
		expect(await readdir(path)).toEqual([]);
		await recoverSealedWorkspaces({ minimumAgeMs: 0 });
		await expect(readdir(dirname(path))).rejects.toThrow();
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
});
